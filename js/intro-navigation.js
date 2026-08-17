const introIdentity = document.querySelector(".intro-identity");
const introTrigger = document.querySelector(".intro-trigger");

if (introIdentity && introTrigger) {
  function setNavigationOpen(isOpen) {
    introIdentity.classList.toggle("is-open", isOpen);
    introTrigger.setAttribute("aria-expanded", String(isOpen));
    introTrigger.setAttribute(
      "aria-label",
      isOpen ? "Kontakt ausblenden" : "Kontakt anzeigen"
    );
  }

  introTrigger.addEventListener("click", () => {
    setNavigationOpen(!introIdentity.classList.contains("is-open"));
  });

  introTrigger.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setNavigationOpen(!introIdentity.classList.contains("is-open"));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setNavigationOpen(false);
  });
}
