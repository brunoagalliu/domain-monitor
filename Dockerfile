FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

COPY package*.json ./

# Skip postinstall (playwright install --with-deps chrome) since the base image
# already has all Linux deps. Install Chrome directly into Playwright's cache.
RUN npm ci --ignore-scripts && npx playwright install chrome

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
