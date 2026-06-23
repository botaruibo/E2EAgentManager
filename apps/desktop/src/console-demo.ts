import { mkdir, writeFile } from "node:fs/promises";
import { BaiyingMvpAppService } from "../../../packages/runtime/src/index.js";
import { JsonFileRunStore } from "../../../packages/storage/src/index.js";
import { renderRunConsole } from "./render-console.js";

const sampleCsv = `rowId,productUrl,title,groupName,remark
row-1,https://example.com/product/1,示例商品A,默认分组,first sample
row-2,https://example.com/product/2,示例商品B,默认分组,second sample`;

await mkdir(".tmp", { recursive: true });

const app = new BaiyingMvpAppService(new JsonFileRunStore(".tmp/runs.json"));
const result = await app.runProducts({
  csv: sampleCsv,
  mode: "dry_run"
});

if (!result.ok) {
  throw new Error(result.errors.join("\n"));
}

const html = renderRunConsole(result.value);
await writeFile(".tmp/console.html", html, "utf8");
console.log(".tmp/console.html");
