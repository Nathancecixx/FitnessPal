FROM node:20-alpine AS build
WORKDIR /srv/web
COPY package.json tsconfig.json tsconfig.node.json vite.config.ts tailwind.config.ts postcss.config.cjs index.html ./
COPY public ./public
COPY src ./src
RUN npm install && npm run build

FROM nginx:1.27-alpine
COPY --from=build /srv/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
