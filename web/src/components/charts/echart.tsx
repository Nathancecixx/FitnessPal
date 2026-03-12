import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import type { EChartsReactProps } from 'echarts-for-react/lib/types'
import { useEffect, useMemo, useState } from 'react'

echarts.use([CanvasRenderer, GridComponent, LineChart, TooltipComponent])

type ChartPalette = {
  axis: string
  grid: string
  tooltipBackground: string
  tooltipBorder: string
  tooltipText: string
}

function getChartPalette(): ChartPalette {
  if (typeof window === 'undefined') {
    return {
      axis: '#64748b',
      grid: '#e2e8f0',
      tooltipBackground: 'rgba(255, 255, 255, 0.96)',
      tooltipBorder: 'rgba(148, 163, 184, 0.22)',
      tooltipText: '#0f172a',
    }
  }

  const style = window.getComputedStyle(document.documentElement)
  return {
    axis: style.getPropertyValue('--chart-axis').trim() || '#64748b',
    grid: style.getPropertyValue('--chart-grid').trim() || '#e2e8f0',
    tooltipBackground: style.getPropertyValue('--chart-tooltip-bg').trim() || 'rgba(255, 255, 255, 0.96)',
    tooltipBorder: style.getPropertyValue('--chart-tooltip-border').trim() || 'rgba(148, 163, 184, 0.22)',
    tooltipText: style.getPropertyValue('--chart-tooltip-text').trim() || '#0f172a',
  }
}

function themeAxis(axis: unknown, palette: ChartPalette) {
  const decorate = (value: Record<string, unknown>) => {
    const axisLine = value.axisLine as Record<string, unknown> | undefined
    const axisTick = value.axisTick as Record<string, unknown> | undefined
    const axisLabel = value.axisLabel as Record<string, unknown> | undefined
    const splitLine = value.splitLine as Record<string, unknown> | undefined
    const isValueAxis = value.type === 'value'

    return {
      ...value,
      axisLine: {
        ...(axisLine ?? {}),
        lineStyle: {
          ...((axisLine?.lineStyle as Record<string, unknown> | undefined) ?? {}),
          color: palette.grid,
        },
      },
      axisTick: {
        ...(axisTick ?? {}),
        lineStyle: {
          ...((axisTick?.lineStyle as Record<string, unknown> | undefined) ?? {}),
          color: palette.grid,
        },
      },
      axisLabel: {
        ...(axisLabel ?? {}),
        color: palette.axis,
      },
      splitLine: splitLine || isValueAxis
        ? {
            ...(splitLine ?? {}),
            lineStyle: {
              ...((splitLine?.lineStyle as Record<string, unknown> | undefined) ?? {}),
              color: palette.grid,
            },
          }
        : splitLine,
    }
  }

  if (Array.isArray(axis)) {
    return axis.map((value) => decorate(value as Record<string, unknown>))
  }

  if (axis && typeof axis === 'object') {
    return decorate(axis as Record<string, unknown>)
  }

  return axis
}

export function EChart(props: EChartsReactProps) {
  const [palette, setPalette] = useState(getChartPalette)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') {
      return
    }

    const root = document.documentElement
    const observer = new MutationObserver(() => setPalette(getChartPalette()))
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'style'] })

    return () => observer.disconnect()
  }, [])

  const option = useMemo(() => {
    if (!props.option) {
      return props.option
    }

    const tooltip = (props.option.tooltip ?? {}) as Record<string, unknown>
    const legend = (props.option.legend ?? {}) as Record<string, unknown>
    const textStyle = (props.option.textStyle ?? {}) as Record<string, unknown>

    return {
      ...props.option,
      backgroundColor: 'transparent',
      textStyle: {
        ...textStyle,
        color: palette.axis,
      },
      legend: {
        ...legend,
        textStyle: {
          ...((legend.textStyle as Record<string, unknown> | undefined) ?? {}),
          color: palette.axis,
        },
      },
      tooltip: {
        ...tooltip,
        backgroundColor: palette.tooltipBackground,
        borderColor: palette.tooltipBorder,
        textStyle: {
          ...((tooltip.textStyle as Record<string, unknown> | undefined) ?? {}),
          color: palette.tooltipText,
        },
      },
      xAxis: themeAxis(props.option.xAxis, palette),
      yAxis: themeAxis(props.option.yAxis, palette),
    }
  }, [palette, props.option])

  return <ReactEChartsCore echarts={echarts} {...props} option={option} />
}
