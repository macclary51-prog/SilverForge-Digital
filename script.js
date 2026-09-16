const menuButton = document.getElementById("menuButton");
const navigation = document.getElementById("navigation");

if (menuButton && navigation) {
    menuButton.addEventListener("click", function () {
        const isOpen = navigation.classList.toggle("open");

        menuButton.setAttribute(
            "aria-expanded",
            String(isOpen)
        );

        menuButton.setAttribute(
            "aria-label",
            isOpen ? "Close navigation" : "Open navigation"
        );
    });

    navigation.querySelectorAll("a").forEach(function (link) {
        link.addEventListener("click", function () {
            navigation.classList.remove("open");

            menuButton.setAttribute(
                "aria-expanded",
                "false"
            );

            menuButton.setAttribute(
                "aria-label",
                "Open navigation"
            );
        });
    });
}

document
    .querySelectorAll("[data-current-year]")
    .forEach(function (year) {
        year.textContent = new Date().getFullYear();
    });
// A previously enabled admin can receive foreground alerts while browsing public pages.
try {
    if (Object.keys(localStorage).some(key => key.startsWith('silverforge-push-optin:') && localStorage.getItem(key) === 'true')) {
        import('./push-foreground.js').catch(() => {});
    }
} catch { /* Public navigation remains available when browser storage is restricted. */ }
