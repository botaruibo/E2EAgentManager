import { BaiyingMvpAppService } from "../../../packages/runtime/src/index.js";

const sampleCsv = `rowId,productUrl,title,groupName,remark
row-1,https://example.com/product/1,示例商品,默认分组,dry run sample`;

const app = new BaiyingMvpAppService();
const result = await app.runProducts({
  csv: sampleCsv,
  mode: "dry_run"
});

if (!result.ok) {
  console.error(result.errors.join("\n"));
} else {
  console.log(JSON.stringify(result.value, null, 2));
}
