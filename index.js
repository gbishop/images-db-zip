import { html, render } from "uhtml";
import { openDB } from "idb";
import { zipSync, strToU8 } from "fflate";

const dbp = openDB("db", 1, {
  upgrade(db) {
    db.createObjectStore("images", {
      keyPath: "hash",
    });
  },
});

async function main() {
  const values = await (await dbp).getAll("images");
  const imgs = values.map((value) => {
    const img = new Image();
    img.src = URL.createObjectURL(value.content);
    img.title = value.name;
    return img;
  });
  render(
    document.body,
    html`<label for="images">Upload some images</label>
      <input
        id="images"
        type="file"
        multiple
        accept=".png,.jpg"
        onchange=${addImages}
      />
      <button onclick=${createZip}>Export</button>
      <div>${imgs}</div>`
  );
}

/** @param {InputEvent} event */
async function addImages(event) {
  const input = /** @type {HTMLInputElement} */ (event.target);
  if (!input || !input.files || !input.files.length) {
    console.log("no files selected");
    return;
  }
  const db = await dbp;
  for (const file of input.files) {
    const h = file.size; // await hash(file);
    console.log(file.name, h);
    const test = await db.get("images", h);
    if (test) {
      console.log(file.name, "is dup");
    } else {
      await db.add("images", {
        name: file.name,
        content: file,
        hash: h,
      });
    }
  }
  main();
}

function hash(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onloadend = () =>
      fr.result instanceof ArrayBuffer &&
      resolve(crypto.subtle.digest("SHA-256", fr.result));
    fr.readAsArrayBuffer(blob);
  });
}

async function createZip() {
  const json = { stuff: "here" };
  const db = await dbp;
  const values = await db.getAll("images");
  const zipargs = { json: strToU8(JSON.stringify(json)) };
  for (const value of values) {
    const contentBuf = await value.content.arrayBuffer();
    const content = new Uint8Array(contentBuf);
    zipargs[value.name] = [content, { level: 0 }];
  }
  console.log(zipargs);
  const zip = zipSync(zipargs);
  const blob = new Blob([zip], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("A");
  a.setAttribute("href", url);
  a.setAttribute("download", "export.zip");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

main();
