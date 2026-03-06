from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.database import get_session
from app.core.idempotency import IdempotentRoute
from app.core.jobs import enqueue_job
from app.core.local_ai import analyze_meal_photo
from app.core.logic import MacroProfile, aggregate_macros, recipe_per_serving, scale_macros
from app.core.models import (
    FoodItem,
    MealEntry,
    MealEntryItem,
    MealTemplate,
    MealTemplateItem,
    PhotoAnalysisDraft,
    Recipe,
    RecipeItem,
    utcnow,
)
from app.core.modules import ModuleManifest
from app.core.schemas import AgentExample, DashboardCardDefinition, DashboardCardState
from app.core.security import Actor, get_actor
from app.core.storage import save_upload


router = APIRouter(route_class=IdempotentRoute, tags=["nutrition"])


class FoodCreate(BaseModel):
    name: str
    brand: str | None = None
    serving_name: str | None = None
    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    fiber_g: float = 0
    sugar_g: float = 0
    sodium_mg: float = 0
    notes: str | None = None
    is_favorite: bool = False
    tags_json: list[str] = Field(default_factory=list)


class RecipeItemInput(BaseModel):
    food_id: str
    grams: float


class RecipeCreate(BaseModel):
    name: str
    servings: float = 1
    instructions_json: list[str] = Field(default_factory=list)
    notes: str | None = None
    tags_json: list[str] = Field(default_factory=list)
    items: list[RecipeItemInput] = Field(default_factory=list)


class MealItemInput(BaseModel):
    food_id: str | None = None
    label: str
    grams: float | None = None
    calories: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    fiber_g: float | None = None
    sodium_mg: float | None = None
    source_type: str = "manual"


class MealTemplateCreate(BaseModel):
    name: str
    meal_type: str = "meal"
    notes: str | None = None
    tags_json: list[str] = Field(default_factory=list)
    items: list[MealItemInput] = Field(default_factory=list)


class MealCreate(BaseModel):
    meal_type: str = "meal"
    logged_at: datetime | None = None
    notes: str | None = None
    tags_json: list[str] = Field(default_factory=list)
    template_id: str | None = None
    recipe_id: str | None = None
    items: list[MealItemInput] = Field(default_factory=list)
    source: str = "manual"


class PhotoConfirmRequest(BaseModel):
    meal_type: str = "meal"
    notes: str | None = None
    tags_json: list[str] = Field(default_factory=list)
    items: list[MealItemInput] | None = None


@router.get("/foods")
def list_foods(
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
    search: str | None = Query(default=None),
) -> dict[str, Any]:
    query = select(FoodItem).where(FoodItem.deleted_at.is_(None)).order_by(FoodItem.name.asc())
    if search:
        query = query.where(or_(FoodItem.name.ilike(f"%{search}%"), FoodItem.brand.ilike(f"%{search}%")))
    rows = session.scalars(query).all()
    return {"items": [serialize_food(row) for row in rows], "total": len(rows), "requested_by": actor.display_name}


@router.post("/foods", status_code=status.HTTP_201_CREATED)
def create_food(
    payload: FoodCreate,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = FoodItem(**payload.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)
    write_audit(session, actor, "food.created", "food", row.id, payload.model_dump())
    return serialize_food(row)


@router.get("/foods/{food_id}")
def get_food(food_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(FoodItem, food_id)
    if not row or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Food not found.")
    return serialize_food(row)


@router.get("/recipes")
def list_recipes(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(select(Recipe).where(Recipe.deleted_at.is_(None)).order_by(Recipe.created_at.desc())).all()
    return {"items": [serialize_recipe(session, row) for row in rows], "total": len(rows)}


@router.post("/recipes", status_code=status.HTTP_201_CREATED)
def create_recipe(
    payload: RecipeCreate,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = Recipe(
        name=payload.name,
        servings=payload.servings,
        instructions_json=payload.instructions_json,
        notes=payload.notes,
        tags_json=payload.tags_json,
    )
    session.add(row)
    session.commit()
    for item in payload.items:
        if not session.get(FoodItem, item.food_id):
            raise HTTPException(status_code=404, detail=f"Food {item.food_id} not found.")
        session.add(RecipeItem(recipe_id=row.id, food_id=item.food_id, grams=item.grams))
    session.commit()
    session.refresh(row)
    write_audit(session, actor, "recipe.created", "recipe", row.id, payload.model_dump())
    return serialize_recipe(session, row)


@router.get("/recipes/{recipe_id}")
def get_recipe(recipe_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(Recipe, recipe_id)
    if not row or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Recipe not found.")
    return serialize_recipe(session, row)


@router.get("/meal-templates")
def list_meal_templates(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(select(MealTemplate).where(MealTemplate.deleted_at.is_(None)).order_by(MealTemplate.created_at.desc())).all()
    return {"items": [serialize_meal_template(session, row) for row in rows], "total": len(rows)}


@router.post("/meal-templates", status_code=status.HTTP_201_CREATED)
def create_meal_template(
    payload: MealTemplateCreate,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = MealTemplate(name=payload.name, meal_type=payload.meal_type, notes=payload.notes, tags_json=payload.tags_json)
    session.add(row)
    session.commit()
    for item in payload.items:
        normalized = normalize_meal_item(session, item)
        session.add(MealTemplateItem(meal_template_id=row.id, **normalized))
    session.commit()
    session.refresh(row)
    write_audit(session, actor, "meal_template.created", "meal_template", row.id, payload.model_dump())
    return serialize_meal_template(session, row)


@router.get("/meal-templates/{template_id}")
def get_meal_template(template_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(MealTemplate, template_id)
    if not row or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Meal template not found.")
    return serialize_meal_template(session, row)


@router.get("/meals")
def list_meals(
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    meal_type: str | None = Query(default=None),
    template_id: str | None = Query(default=None),
) -> dict[str, Any]:
    query = select(MealEntry).where(MealEntry.deleted_at.is_(None)).order_by(MealEntry.logged_at.desc())
    conditions = []
    if date_from:
        conditions.append(MealEntry.logged_at >= date_from)
    if date_to:
        conditions.append(MealEntry.logged_at <= date_to)
    if meal_type:
        conditions.append(MealEntry.meal_type == meal_type)
    if template_id:
        conditions.append(MealEntry.template_id == template_id)
    if conditions:
        query = query.where(and_(*conditions))
    rows = session.scalars(query).all()
    return {"items": [serialize_meal(session, row) for row in rows], "total": len(rows)}


@router.post("/meals", status_code=status.HTTP_201_CREATED)
def create_meal(
    payload: MealCreate,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    items = expand_meal_payload(session, payload)
    totals = aggregate_macros([item_to_profile(item) for item in items])
    row = MealEntry(
        logged_at=payload.logged_at or utcnow(),
        meal_type=payload.meal_type,
        source=payload.source,
        notes=payload.notes,
        tags_json=payload.tags_json,
        template_id=payload.template_id,
        recipe_id=payload.recipe_id,
        total_calories=totals.calories,
        total_protein_g=totals.protein_g,
        total_carbs_g=totals.carbs_g,
        total_fat_g=totals.fat_g,
        total_fiber_g=totals.fiber_g,
        total_sodium_mg=totals.sodium_mg,
    )
    session.add(row)
    session.commit()
    for item in items:
        session.add(MealEntryItem(meal_entry_id=row.id, **item))
    session.commit()
    enqueue_job(session, "insights.recompute", {"source": "meal", "meal_id": row.id}, dedupe_key=f"insights-live:{utcnow().strftime('%Y%m%d%H%M')}")
    write_audit(session, actor, "meal.created", "meal", row.id, payload.model_dump())
    return serialize_meal(session, row)


@router.get("/meals/{meal_id}")
def get_meal(meal_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(MealEntry, meal_id)
    if not row or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Meal not found.")
    return serialize_meal(session, row)


@router.delete("/meals/{meal_id}")
def delete_meal(meal_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    row = session.get(MealEntry, meal_id)
    if not row or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Meal not found.")
    row.deleted_at = utcnow()
    session.commit()
    write_audit(session, actor, "meal.deleted", "meal", row.id, {"meal_type": row.meal_type})
    enqueue_job(session, "insights.recompute", {"source": "meal_delete", "meal_id": row.id}, dedupe_key=f"insights-live:{utcnow().strftime('%Y%m%d%H%M')}")
    return {"status": "deleted", "id": row.id}


@router.get("/meal-photos")
def list_meal_photos(actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    rows = session.scalars(select(PhotoAnalysisDraft).order_by(PhotoAnalysisDraft.created_at.desc())).all()
    return {"items": [serialize_photo_draft(row) for row in rows], "total": len(rows)}


@router.post("/meal-photos", status_code=status.HTTP_201_CREATED)
def upload_meal_photo(
    file: UploadFile = File(...),
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    target = save_upload(file)
    draft = PhotoAnalysisDraft(status="queued", source_path=str(target))
    session.add(draft)
    session.commit()
    session.refresh(draft)
    enqueue_job(session, "nutrition.analyze_photo", {"draft_id": draft.id}, dedupe_key=f"photo:{draft.id}")
    write_audit(session, actor, "meal_photo.created", "meal_photo", draft.id, {"path": str(target)})
    return serialize_photo_draft(draft)


@router.post("/meal-photos/{draft_id}/analyze")
def rerun_photo_analysis(draft_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    draft = session.get(PhotoAnalysisDraft, draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Meal photo draft not found.")
    draft.status = "queued"
    draft.error_message = None
    session.commit()
    enqueue_job(session, "nutrition.analyze_photo", {"draft_id": draft.id}, dedupe_key=f"photo-rerun:{draft.id}:{utcnow().strftime('%Y%m%d%H%M%S')}")
    return serialize_photo_draft(draft)


@router.get("/meal-photos/{draft_id}")
def get_meal_photo(draft_id: str, actor: Actor = Depends(get_actor), session: Session = Depends(get_session)) -> dict[str, Any]:
    draft = session.get(PhotoAnalysisDraft, draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Meal photo draft not found.")
    return serialize_photo_draft(draft)


@router.post("/meal-photos/{draft_id}/confirm", status_code=status.HTTP_201_CREATED)
def confirm_meal_photo(
    draft_id: str,
    payload: PhotoConfirmRequest,
    actor: Actor = Depends(get_actor),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    draft = session.get(PhotoAnalysisDraft, draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Meal photo draft not found.")
    item_payloads = payload.items if payload.items is not None else [MealItemInput(**item) for item in draft.candidates_json]
    items = [normalize_meal_item(session, item) for item in item_payloads]
    totals = aggregate_macros([item_to_profile(item) for item in items])
    meal = MealEntry(
        logged_at=utcnow(),
        meal_type=payload.meal_type,
        source="photo",
        notes=payload.notes,
        tags_json=payload.tags_json,
        photo_draft_id=draft.id,
        total_calories=totals.calories,
        total_protein_g=totals.protein_g,
        total_carbs_g=totals.carbs_g,
        total_fat_g=totals.fat_g,
        total_fiber_g=totals.fiber_g,
        total_sodium_mg=totals.sodium_mg,
        ai_confidence=draft.confidence,
    )
    session.add(meal)
    session.commit()
    for item in items:
        session.add(MealEntryItem(meal_entry_id=meal.id, **item))
    draft.status = "confirmed"
    draft.meal_entry_id = meal.id
    session.commit()
    enqueue_job(session, "insights.recompute", {"source": "meal_photo", "meal_id": meal.id}, dedupe_key=f"insights-live:{utcnow().strftime('%Y%m%d%H%M')}")
    write_audit(session, actor, "meal_photo.confirmed", "meal_photo", draft.id, {"meal_id": meal.id})
    return serialize_meal(session, meal)


def normalize_meal_item(session: Session, payload: MealItemInput) -> dict[str, Any]:
    if payload.food_id:
        food = session.get(FoodItem, payload.food_id)
        if not food or food.deleted_at is not None:
            raise HTTPException(status_code=404, detail=f"Food {payload.food_id} not found.")
        profile = scale_macros(
            MacroProfile(
                calories=food.calories,
                protein_g=food.protein_g,
                carbs_g=food.carbs_g,
                fat_g=food.fat_g,
                fiber_g=food.fiber_g,
                sodium_mg=food.sodium_mg,
            ),
            payload.grams,
        )
        return {
            "food_id": food.id,
            "label": payload.label or food.name,
            "grams": payload.grams,
            "calories": payload.calories if payload.calories is not None else profile.calories,
            "protein_g": payload.protein_g if payload.protein_g is not None else profile.protein_g,
            "carbs_g": payload.carbs_g if payload.carbs_g is not None else profile.carbs_g,
            "fat_g": payload.fat_g if payload.fat_g is not None else profile.fat_g,
            "fiber_g": payload.fiber_g if payload.fiber_g is not None else profile.fiber_g,
            "sodium_mg": payload.sodium_mg if payload.sodium_mg is not None else profile.sodium_mg,
            "source_type": payload.source_type or "food",
        }

    return {
        "food_id": None,
        "label": payload.label,
        "grams": payload.grams,
        "calories": payload.calories or 0,
        "protein_g": payload.protein_g or 0,
        "carbs_g": payload.carbs_g or 0,
        "fat_g": payload.fat_g or 0,
        "fiber_g": payload.fiber_g or 0,
        "sodium_mg": payload.sodium_mg or 0,
        "source_type": payload.source_type or "manual",
    }


def expand_meal_payload(session: Session, payload: MealCreate) -> list[dict[str, Any]]:
    if payload.items:
        return [normalize_meal_item(session, item) for item in payload.items]
    if payload.template_id:
        items = session.scalars(select(MealTemplateItem).where(MealTemplateItem.meal_template_id == payload.template_id)).all()
        if not items:
            raise HTTPException(status_code=404, detail="Meal template not found or empty.")
        return [serialize_template_item(item) for item in items]
    if payload.recipe_id:
        recipe = session.get(Recipe, payload.recipe_id)
        if not recipe or recipe.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Recipe not found.")
        recipe_items = session.scalars(select(RecipeItem).where(RecipeItem.recipe_id == recipe.id)).all()
        normalized: list[dict[str, Any]] = []
        for item in recipe_items:
            food = session.get(FoodItem, item.food_id)
            if not food or food.deleted_at is not None:
                continue
            normalized.append(
                normalize_meal_item(
                    session,
                    MealItemInput(food_id=food.id, label=food.name, grams=item.grams, source_type="recipe"),
                )
            )
        return normalized
    raise HTTPException(status_code=422, detail="Provide items, a recipe_id, or a template_id.")


def item_to_profile(item: dict[str, Any]) -> MacroProfile:
    return MacroProfile(
        calories=float(item.get("calories") or 0),
        protein_g=float(item.get("protein_g") or 0),
        carbs_g=float(item.get("carbs_g") or 0),
        fat_g=float(item.get("fat_g") or 0),
        fiber_g=float(item.get("fiber_g") or 0),
        sodium_mg=float(item.get("sodium_mg") or 0),
    )


def serialize_food(row: FoodItem) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "brand": row.brand,
        "serving_name": row.serving_name,
        "calories": row.calories,
        "protein_g": row.protein_g,
        "carbs_g": row.carbs_g,
        "fat_g": row.fat_g,
        "fiber_g": row.fiber_g,
        "sugar_g": row.sugar_g,
        "sodium_mg": row.sodium_mg,
        "notes": row.notes,
        "is_favorite": row.is_favorite,
        "tags_json": row.tags_json,
        "created_at": row.created_at.isoformat(),
    }


def serialize_recipe(session: Session, row: Recipe) -> dict[str, Any]:
    items = session.scalars(select(RecipeItem).where(RecipeItem.recipe_id == row.id)).all()
    macro_items: list[MacroProfile] = []
    serialized_items = []
    for item in items:
        food = session.get(FoodItem, item.food_id)
        if not food or food.deleted_at is not None:
            continue
        profile = scale_macros(
            MacroProfile(
                calories=food.calories,
                protein_g=food.protein_g,
                carbs_g=food.carbs_g,
                fat_g=food.fat_g,
                fiber_g=food.fiber_g,
                sodium_mg=food.sodium_mg,
            ),
            item.grams,
        )
        macro_items.append(profile)
        serialized_items.append({
            "id": item.id,
            "food_id": food.id,
            "food_name": food.name,
            "grams": item.grams,
            "macros": macro_profile_to_dict(profile),
        })
    per_serving = recipe_per_serving(macro_items, row.servings)
    return {
        "id": row.id,
        "name": row.name,
        "servings": row.servings,
        "instructions_json": row.instructions_json,
        "notes": row.notes,
        "tags_json": row.tags_json,
        "items": serialized_items,
        "per_serving": macro_profile_to_dict(per_serving),
        "created_at": row.created_at.isoformat(),
    }


def serialize_template_item(item: MealTemplateItem) -> dict[str, Any]:
    return {
        "food_id": item.food_id,
        "label": item.label,
        "grams": item.grams,
        "calories": item.calories,
        "protein_g": item.protein_g,
        "carbs_g": item.carbs_g,
        "fat_g": item.fat_g,
        "fiber_g": item.fiber_g,
        "sodium_mg": item.sodium_mg,
        "source_type": item.source_type,
    }


def serialize_meal_template(session: Session, row: MealTemplate) -> dict[str, Any]:
    items = session.scalars(select(MealTemplateItem).where(MealTemplateItem.meal_template_id == row.id)).all()
    totals = aggregate_macros([item_to_profile(serialize_template_item(item)) for item in items])
    return {
        "id": row.id,
        "name": row.name,
        "meal_type": row.meal_type,
        "notes": row.notes,
        "tags_json": row.tags_json,
        "items": [serialize_template_item(item) for item in items],
        "totals": macro_profile_to_dict(totals),
        "created_at": row.created_at.isoformat(),
    }


def serialize_meal(session: Session, row: MealEntry) -> dict[str, Any]:
    items = session.scalars(select(MealEntryItem).where(MealEntryItem.meal_entry_id == row.id)).all()
    return {
        "id": row.id,
        "logged_at": row.logged_at.isoformat(),
        "meal_type": row.meal_type,
        "source": row.source,
        "notes": row.notes,
        "tags_json": row.tags_json,
        "template_id": row.template_id,
        "recipe_id": row.recipe_id,
        "photo_draft_id": row.photo_draft_id,
        "totals": {
            "calories": row.total_calories,
            "protein_g": row.total_protein_g,
            "carbs_g": row.total_carbs_g,
            "fat_g": row.total_fat_g,
            "fiber_g": row.total_fiber_g,
            "sodium_mg": row.total_sodium_mg,
        },
        "ai_confidence": row.ai_confidence,
        "items": [
            {
                "id": item.id,
                "food_id": item.food_id,
                "label": item.label,
                "grams": item.grams,
                "calories": item.calories,
                "protein_g": item.protein_g,
                "carbs_g": item.carbs_g,
                "fat_g": item.fat_g,
                "fiber_g": item.fiber_g,
                "sodium_mg": item.sodium_mg,
                "source_type": item.source_type,
            }
            for item in items
        ],
    }


def macro_profile_to_dict(profile: MacroProfile) -> dict[str, float]:
    return {
        "calories": profile.calories,
        "protein_g": profile.protein_g,
        "carbs_g": profile.carbs_g,
        "fat_g": profile.fat_g,
        "fiber_g": profile.fiber_g,
        "sodium_mg": profile.sodium_mg,
    }


def serialize_photo_draft(row: PhotoAnalysisDraft) -> dict[str, Any]:
    return {
        "id": row.id,
        "status": row.status,
        "source_path": row.source_path,
        "provider": row.provider,
        "model_name": row.model_name,
        "confidence": row.confidence,
        "candidates": row.candidates_json,
        "error_message": row.error_message,
        "meal_entry_id": row.meal_entry_id,
        "created_at": row.created_at.isoformat(),
    }


def load_dashboard_cards(session: Session) -> list[DashboardCardState]:
    today = utcnow().date()
    meals = session.scalars(select(MealEntry).where(MealEntry.deleted_at.is_(None))).all()
    today_meals = [meal for meal in meals if meal.logged_at.date() == today]
    calories = sum(meal.total_calories for meal in today_meals)
    return [
        DashboardCardState(
            key="today-calories",
            title="Today Calories",
            route="/nutrition",
            description="Current daily calorie intake.",
            accent="amber",
            value=round(calories),
            detail=f"{len(today_meals)} meals logged today",
            status="neutral",
        )
    ]


def analyze_photo_job(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    draft = session.get(PhotoAnalysisDraft, payload["draft_id"])
    if not draft:
        raise ValueError("Photo draft not found.")
    try:
        draft.status = "processing"
        draft.error_message = None
        session.commit()
        result = analyze_meal_photo(Path(draft.source_path))
        draft.status = "ready"
        draft.provider = str(result.get("provider"))
        draft.model_name = str(result.get("model_name"))
        draft.confidence = float(result.get("confidence") or 0)
        draft.candidates_json = [
            {
                "label": item.get("label", "Unknown item"),
                "grams": item.get("grams"),
                "calories": item.get("calories"),
                "protein_g": item.get("protein_g"),
                "carbs_g": item.get("carbs_g"),
                "fat_g": item.get("fat_g"),
                "fiber_g": item.get("fiber_g", 0),
                "sodium_mg": item.get("sodium_mg", 0),
                "source_type": "photo_ai",
            }
            for item in result.get("items", [])
        ]
        if not draft.candidates_json:
            draft.status = "needs_review"
            draft.error_message = "No candidates returned by AI provider."
        session.commit()
        return serialize_photo_draft(draft)
    except Exception as exc:
        draft.status = "failed"
        draft.error_message = str(exc)
        session.commit()
        raise


manifest = ModuleManifest(
    key="nutrition",
    router=router,
    dashboard_cards=[
        DashboardCardDefinition(
            key="today-calories",
            title="Today Calories",
            route="/nutrition",
            description="Daily nutrition intake and meal log.",
            accent="amber",
            priority=20,
        )
    ],
    dashboard_loader=load_dashboard_cards,
    agent_examples=[
        AgentExample(
            key="create-food",
            title="Create food item",
            method="POST",
            path="/api/v1/foods",
            summary="Store a reusable local ingredient with per-100g macros.",
            request_body={
                "name": "Chicken breast",
                "calories": 165,
                "protein_g": 31,
                "carbs_g": 0,
                "fat_g": 3.6,
            },
        ),
        AgentExample(
            key="create-meal",
            title="Log meal",
            method="POST",
            path="/api/v1/meals",
            summary="Create a meal from manual macros, foods, recipes, or templates.",
            request_body={
                "meal_type": "lunch",
                "items": [
                    {"food_id": "food_ulid_here", "label": "Chicken breast", "grams": 200, "source_type": "food"},
                    {"label": "Rice", "calories": 260, "protein_g": 5.4, "carbs_g": 57, "fat_g": 0.6},
                ],
            },
        ),
    ],
    job_handlers={"nutrition.analyze_photo": analyze_photo_job},
)


