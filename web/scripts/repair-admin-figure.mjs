import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import sharp from "sharp";

const root=resolve(new URL("../",import.meta.url).pathname.slice(1));
const db=new DatabaseSync(resolve(root,"data/eduvault.sqlite"));
const user=db.prepare("select id from users where email=?").get("admin@eduvault.local");
if(!user)throw new Error("Không có admin local");
const row=db.prepare("select state_json from workspaces where user_id=?").get(user.id);
const state=JSON.parse(row.state_json);
const all=[...(state.bank||[]),...(state.pending||[])];
const question=all.find(q=>q.id==="qmsrdjx9m47v");
if(!question)throw new Error("Không tìm thấy câu hình lập phương");
const jobId="1c963937-4942-44a6-af27-092b2fd60682";
const page=resolve(root,`data/jobs/${jobId}/page-1.png`);
const target=resolve(root,`data/jobs/${jobId}/assets/p1-q7-s1-fixed.png`);
const box=[0.34,0.505,0.60,0.63];
const meta=await sharp(page).metadata();
await sharp(page).extract({
  left:Math.round(box[0]*meta.width),top:Math.round(box[1]*meta.height),
  width:Math.round((box[2]-box[0])*meta.width),height:Math.round((box[3]-box[1])*meta.height),
}).png({compressionLevel:9}).toFile(target);
question.fig={...question.fig,bbox:box,src:`/api/jobs/${jobId}/assets/p1-q7-s1-fixed.png`,origin:"repair"};
question.figures=[question.fig];
question.stem=String(question.stem||"").replace(/\s*\[\[IMG:\d+\]\]\s*/gi," ").replace(/\s{2,}/g," ").trim();
db.prepare("update workspaces set state_json=?,updated_at=? where user_id=?")
  .run(JSON.stringify(state),new Date().toISOString(),user.id);
console.log(target);
