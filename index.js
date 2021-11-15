import { html, render } from "uhtml";
import { openDB } from "idb";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { fileOpen, fileSave, supported } from "browser-fs-access";

const dbp = openDB("db", 1, {
  upgrade(db) {
    db.createObjectStore("images", {
      keyPath: "hash",
    });
  },
});

async function main() {
  // display the images from the db to show they are there
  const db = await dbp;
  const values = await db.getAll("images");
  const imgs = values.map((value) => {
    const img = new Image();
    img.src = URL.createObjectURL(value.content);
    img.title = value.name;
    return img;
  });
  // allow uploading images, exporting and importing zip with images
  render(
    document.body,
    html`<p>You can open an existing design</p>
      <button onclick=${openDesign}>Open</button>
      <p>And you should be able to save back to it later.</p>
      <button onclick=${saveDesign}>Save</button>
      <p>
        Upload multiple images by with shift click. They should appear below.
      </p>
      <label for="images">Upload some images</label>
      <input
        id="images"
        type="file"
        multiple
        accept=".png,.jpg"
        onchange=${addImages}
      />
      <p>You can Export the images along with some fake json in a Zip file.</p>
      <button onclick=${exportZip}>Export</button>
      <p>You can Import the images and json here.</p>
      <label for="import">Import</label>
      <input id="import" type="file" accept=".zip" onchange=${importZip} />
      <label for="importurl">Remote import</label>
      <input id="importurl" type="url" onchange=${importUrl} />
      <p>You can clear the db here.</p>
      <button onclick=${clearDb}>Clear</button>
      <p>The images should appear here.</p>
      <div>${imgs}</div>`
  );
}

/** @type {import("browser-fs-access").FileSystemHandle | undefined} */
let existingHandle;
/** @type {string} */
let existingName;

async function openDesign() {
  const blob = await fileOpen({
    mimeTypes: ["application/zip"],
    extensions: [".osdpi", ".zip"],
    description: "OS-DPI designs",
    id: "os-dpi",
  });
  // keep the handle so we can save to it later
  existingHandle = blob.handle;
  existingName = blob.name;

  // clear the previous one
  const db = await dbp;
  await db.clear("images");
  // load the new one
  const zippedBuf = await readAsArrayBuffer(blob);
  const zippedArray = new Uint8Array(zippedBuf);
  const unzipped = unzipSync(zippedArray);
  for (const fname in unzipped) {
    if (fname.endsWith("json")) {
      const text = strFromU8(unzipped[fname]);
      const obj = JSON.parse(text);
      console.log("json", obj);
    } else if (fname.endsWith(".png")) {
      const blob = new Blob([unzipped[fname]], { type: "image/png" });
      await addImage(blob, fname);
    }
  }
  // show what we loaded
  main();
}

async function saveDesign() {
  // fake up some json content for testing
  const json = { stuff: "here" };
  const zipargs = { "design.json": strToU8(JSON.stringify(json)) };
  // grab all the images
  const db = await dbp;
  const values = await db.getAll("images");
  // for each image convert to Uint8Array and add to the zip args
  for (const value of values) {
    const contentBuf = await value.content.arrayBuffer();
    const content = new Uint8Array(contentBuf);
    zipargs[value.name] = [content, { level: 0 }];
  }
  // zip it
  const zip = zipSync(zipargs);
  // create a blob from the zipped result
  const blob = new Blob([zip], { type: "application/zip" });
  const options = {
    fileName: existingName,
    extensions: [".osdpi", ".zip"],
    id: "osdpi",
  };
  await fileSave(blob, options, existingHandle);
  console.log("saved file");
}

/** Add an image to the db
 * @param {Blob} blob
 * @param {string} name
 */
async function addImage(blob, name) {
  const db = await dbp;
  const h = await hash(blob);
  const test = await db.get("images", h);
  if (test) {
    console.log(name, "is dup");
  } else {
    await db.put("images", {
      name: name,
      content: blob,
      hash: h,
    });
  }
}

/**
 * Add images from the file input to the database
 * @param {InputEvent} event */
async function addImages(event) {
  const input = /** @type {HTMLInputElement} */ (event.target);
  if (!input || !input.files || !input.files.length) {
    console.log("no files selected");
    return;
  }
  for (const file of input.files) {
    await addImage(file, file.name);
  }
  main();
}

/** Convert a blob into an array buffer
 * @param {Blob} blob */
function readAsArrayBuffer(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onloadend = () => fr.result instanceof ArrayBuffer && resolve(fr.result);
    fr.readAsArrayBuffer(blob);
  });
}

/** Compute the hash of a blob for de-duping the database
 * @param {Blob} blob */
async function hash(blob) {
  const buf = await readAsArrayBuffer(blob);
  return crypto.subtle.digest("SHA-256", buf);
}

/** Create a zip file with some json and image content */
async function exportZip() {
  // fake up some json content for testing
  const json = { stuff: "here" };
  const zipargs = { "design.json": strToU8(JSON.stringify(json)) };
  // grab all the images
  const db = await dbp;
  const values = await db.getAll("images");
  // for each image convert to Uint8Array and add to the zip args
  for (const value of values) {
    const contentBuf = await value.content.arrayBuffer();
    const content = new Uint8Array(contentBuf);
    zipargs[value.name] = [content, { level: 0 }];
  }
  // zip it
  const zip = zipSync(zipargs);
  // create a blob from the zipped result
  const blob = new Blob([zip], { type: "application/octet-stream" });
  // create an object url for it
  const url = URL.createObjectURL(blob);
  // create a download link and click it
  const a = document.createElement("A");
  a.setAttribute("href", url);
  a.setAttribute("download", "export.zip");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Import a zip like the one created above
 * @param {InputEvent} event */
async function importZip(event) {
  const input = /** @type {HTMLInputElement} */ (event.target);
  if (!input || !input.files || !input.files.length) {
    console.log("no files selected");
    return;
  }
  /* this is quite a dance, are all these steps required? */
  const zipped = input.files[0];
  const zippedBuf = await readAsArrayBuffer(zipped);
  const zippedArray = new Uint8Array(zippedBuf);
  const unzipped = unzipSync(zippedArray);
  for (const fname in unzipped) {
    if (fname.endsWith("json")) {
      const text = strFromU8(unzipped[fname]);
      const obj = JSON.parse(text);
      console.log("json", obj);
    } else if (fname.endsWith(".png")) {
      const blob = new Blob([unzipped[fname]], { type: "image/png" });
      await addImage(blob, fname);
    }
  }
  main();
}

/** Import a zip from a URL
 * @param {InputEvent} event */
async function importUrl(event) {
  const input = /** @type {HTMLInputElement} */ (event.target);
  if (!input || !input.value) {
    console.log("no url provided");
    return;
  }
  /* this is quite a dance, are all these steps required? */
  const resp = await fetch(input.value);
  const zippedBuf = await resp.arrayBuffer();
  const zippedArray = new Uint8Array(zippedBuf);
  const unzipped = unzipSync(zippedArray);
  for (const fname in unzipped) {
    if (fname.endsWith("json")) {
      const text = strFromU8(unzipped[fname]);
      const obj = JSON.parse(text);
      console.log("json", obj);
    } else if (fname.endsWith(".png")) {
      const blob = new Blob([unzipped[fname]], { type: "image/png" });
      await addImage(blob, fname);
    }
  }
  main();
}

/** Clear the images store in the db */
async function clearDb() {
  const db = await dbp;
  await db.clear("images");
  main();
}

main();
