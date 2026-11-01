import { mountShelf } from "./application.js";

const root = document.querySelector<HTMLElement>("#app");

if (root === null) {
  throw new Error("Shelf application root (#app) was not found.");
}

mountShelf(root);
