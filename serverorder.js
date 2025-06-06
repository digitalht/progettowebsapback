

// serverorder.js
import express from "express";
import cors from "cors";
import btoa from "btoa";
//import fetch from 'node-fetch';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Aggiungi all'inizio del file, dopo gli import


// Aggiungi questo nuovo endpoint prima di app.listen()
app.post("/openai/chat", async (req, res) => {
    const { message, systemPrompt } = req.body;

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: message }
                ],
                temperature: 0.1
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ OpenAI ERROR (${response.status}):`, errorText);
            return res.status(response.status).send(`Errore OpenAI: ${errorText}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("❌ Errore interno OpenAI:", error);
        res.status(500).send("Errore interno OpenAI.");
    }
});

// Proxy endpoint per SAP
app.get("/sap/:entity", async (req, res) => {
    const { entity } = req.params;

    const sapUrl = `https://htwds4c.h-t.it:44301/sap/opu/odata/sap/ZGW_SMART_PURCHASING_SRV/${entity}?$format=json&sap-client=200`;

    try {
        const response = await fetch(sapUrl, {
            method: "GET",
            headers: {
                "Authorization": "Basic " + btoa("rcarini:Velcome24"),
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`❌ SAP ERROR (${response.status}):`, text);
            return res.status(response.status).send(`Errore SAP: ${text}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("❌ Errore interno nel proxy:", error);
        res.status(500).send("Errore interno nel proxy.");
    }
});

app.get("/sap/order-items/:orderId", async (req, res) => {
    const { orderId } = req.params;
    const sapUrl = `https://htwds4c.h-t.it:44301/sap/opu/odata/sap/ZGW_SMART_PURCHASING_SRV/PurchOrderItemSet?$filter=(OrderNr eq '${orderId}')&$format=xml&sap-client=200`;

    try {
        const response = await fetch(sapUrl, {
            method: "GET",
            headers: {
                "Authorization": "Basic " + btoa("rcarini:Velcome24"),
                "Accept": "application/xml"
            }
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`❌ SAP ERROR (${response.status}):`, text);
            return res.status(response.status).send(`Errore SAP: ${text}`);
        }

        const xmlText = await response.text();

        // Parser XML -> JS (usa DOMParser-like parser o xml2js)
        const { parseStringPromise } = await import("xml2js");

        const result = await parseStringPromise(xmlText, { explicitArray: false });
        const entries = result["feed"]?.["entry"];

        let items = [];

        if (entries) {
            const entriesArray = Array.isArray(entries) ? entries : [entries];

            items = entriesArray.map(entry => {
                const props = entry["content"]["m:properties"];
                return {
                    OrderPos: props["d:OrderPos"],
                    Price: props["d:Price"],
                    ProductId: props["d:ProductId"],
                    ShortText: props["d:ShortText"]
                };
            });
        }

        res.json({ items });
    } catch (error) {
        console.error("❌ Errore interno nel parsing XML:", error);
        res.status(500).send("Errore interno nel parsing XML.");
    }
});

// POST: Rilascia un ordine
import fetch, { Headers } from "node-fetch"; // se non c’è già
import * as tough from "tough-cookie";
import fetchCookie from "fetch-cookie";

// wrapper che gestisce cookie
const fetchWithCookies = fetchCookie(fetch, new tough.CookieJar());

app.post("/sap/release/:orderId", async (req, res) => {
    const { orderId } = req.params;
    const auth = "Basic " + btoa("rcarini:Velcome24");

    const baseUrl = "https://htwds4c.h-t.it:44301/sap/opu/odata/sap/ZGW_SMART_PURCHASING_SRV";
    const csrfUrl = `${baseUrl}/ReleasePo?sap-client=200`;

    try {
        // 1. Ottieni CSRF token con gestione cookies
        const csrfRes = await fetchWithCookies(csrfUrl, {
            method: "GET",
            headers: {
                "Authorization": auth,
                "x-csrf-token": "Fetch"
            }
        });

        const csrfToken = csrfRes.headers.get("x-csrf-token");
        if (!csrfToken) throw new Error("CSRF token non ricevuto");

        // 2. POST con token reale
        const releaseUrl = `${baseUrl}/ReleasePo?sap-client=200&Orders='[{"OrderNr":"${orderId}"}]'`;

        const releaseRes = await fetchWithCookies(releaseUrl, {
            method: "POST",
            headers: {
                "Authorization": auth,
                "x-csrf-token": csrfToken
            }
        });

        if (!releaseRes.ok) {
            const errorText = await releaseRes.text();
            console.error(`❌ SAP Rilascio errore (${releaseRes.status}):`, errorText);
            return res.status(releaseRes.status).send("Errore rilascio SAP");
        }

        const result = await releaseRes.text(); // spesso ritorna stringa
        console.log(`✅ Ordine ${orderId} rilasciato.`);
        res.json({ success: true, message: result });
    } catch (error) {
        console.error("❌ Errore backend:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});



app.listen(PORT, () => {
    console.log(`✅ Server proxy in ascolto su http://localhost:${PORT}`);
});
