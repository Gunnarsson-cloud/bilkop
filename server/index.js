import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { searchCars, researchLoans } from "./search.js";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json" };

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 100_000) throw new Error("för stor förfrågan");
  }
  return data ? JSON.parse(data) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/cars" && req.method === "GET") {
      const p = Object.fromEntries(url.searchParams);
      if (p.sources) p.sources = p.sources.split(",");
      p.zeroRateOnly = p.zeroRateOnly === "1";
      p.pages ??= "3";
      return json(res, 200, await searchCars(p));
    }
    if (url.pathname === "/api/loans" && req.method === "POST") {
      return json(res, 200, await researchLoans(await readBody(req)));
    }
    if (req.method !== "GET") return json(res, 405, { error: "metoden stöds inte" });

    const path = normalize(join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
    if (!path.startsWith(PUBLIC)) return json(res, 403, { error: "förbjudet" });
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "EISDIR") return json(res, 404, { error: "hittades inte" });
    console.error(e);
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Bilkalkylen körs på http://localhost:${PORT}`));
