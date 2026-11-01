export function mountShelf(root: HTMLElement): void {
  const main = document.createElement("main");
  main.className = "shelf-shell";
  main.setAttribute("aria-labelledby", "shelf-title");

  const mark = document.createElement("img");
  mark.className = "shelf-mark";
  mark.src = "/brand/shelf-mark.svg";
  mark.alt = "";
  mark.width = 56;
  mark.height = 56;

  const title = document.createElement("h1");
  title.id = "shelf-title";
  title.textContent = "Shelf";

  const description = document.createElement("p");
  description.className = "shelf-description";
  description.textContent =
    "The reading workspace foundation is ready for the Reader modules.";

  main.append(mark, title, description);
  root.replaceChildren(main);
}
