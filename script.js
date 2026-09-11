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
