# Portfolio tracker
Static page (`index.html`) plus one serverless function (`api/prices.js`) that returns live prices.
Holdings are saved in the browser (localStorage). To add a holding with live prices, add its ticker to `SOURCES` in `api/prices.js`.
Local dev: `npx vercel dev`
