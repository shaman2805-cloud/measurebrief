# Measurebrief

Measurebrief helps flooring installers spot a missing measurement before leaving a job. Paste notes from a site visit, check the dimensions the worksheet found, then export the material estimate. A price appears only when the notes establish the length and width of a rectangular room and the pricing inputs are valid.

[Watch the 68-second demo on YouTube](https://www.youtube.com/watch?v=TIqBawXl_wk).

## Try the example

1. Start with the Studio A survey. It records a 4.8 m room length and a 90 cm doorway. The room width is still missing, so there is no subtotal.
2. Add `Room width: 3.6 m.` With a 10% waste allowance and a sample material price of $25/m², the worksheet shows **17.28 m²** measured, **19.01 m²** to order and **$475.25** in materials.
3. Change the width or add a conflicting measurement. The worksheet recalculates or asks for clarification. The rate is editable. The estimate covers materials for one rectangular room.

## Run the application

Use Node.js 22.12 or later and npm. From this directory:

```sh
npm ci
npm test
npm run build
npm run preview -- --port 8831
```

Open [the local worksheet](http://127.0.0.1:8831/). For development, use `npm run dev`. The example, measurements, evidence and pricing work without a Firebase account.

## Connect Firebase AI Logic

The AI selects source excerpts for the estimator and groups them into measurements, decisions and questions. Both model routes return structured excerpt IDs. The display and export use the original note text for those IDs. A separate worksheet section lists unresolved room dimensions. If the AI sends an invalid response, the original worksheet remains available. The cloud receives notes only when the installer permits a cloud request.

1. Register a web app in your own Firebase project and enable Firebase AI Logic with the Gemini Developer API. Follow the [Firebase web setup](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started).
2. For a hosted app, register its domain in App Check using a reCAPTCHA Enterprise site key. For local development, set `VITE_FIREBASE_APPCHECK_DEBUG=true` in `.env.local` and use `npm run dev`. On the first cloud request, Firebase prints a development token in the browser console. Register that token privately under **App Check → Apps → Manage debug tokens**, then retry in the same browser. Keep the token out of recordings and the repository. See [App Check for web apps](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider) and the [local development instructions](https://firebase.google.com/docs/app-check/web/debug-provider).
3. Copy `.env.example` to `.env.local` and enter the public web app configuration and App Check settings described there. Restart the dev server or rebuild the preview after changing the configuration.
4. Open the worksheet in compatible desktop Chrome while online. If Chrome needs to download its model, the worksheet offers **Prepare device model** before Firebase setup or **Download model & generate** after setup. The first button only prepares Chrome and takes no site notes. Wait for **On-device model ready** before demonstrating offline inference. See [Chrome model requirements](https://developer.chrome.com/docs/ai/get-started).

For a two-part test, use the fictional Studio A notes. In a browser where the local model is unavailable, select **Allow cloud fallback** and look for **Cloud brief** above the returned text. In desktop Chrome with the model ready, load the production build once, go offline and select **Use device only**. A new **On-device brief** confirms that request ran locally. The subtotal by itself verifies only the worksheet calculation.

## Verification

The Studio A example was tested on a compatible desktop Chrome installation with the network disconnected. Firebase AI Logic returned an on-device handoff. An online browser without a ready device model also produced a cloud handoff through Firebase App Check after cloud fallback was enabled. The worksheet separately computed the example material subtotal of $475.25. Run `npm test` for the measurement, pricing and AI-routing regression suite.

## License

Measurebrief is available under the [Apache License 2.0](LICENSE). Built for [Google #BuildHybridAI](https://firebasehybridaihackathon.devpost.com/).
