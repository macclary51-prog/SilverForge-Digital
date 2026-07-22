const menuButton = document.getElementById("menuButton");
const navigation = document.getElementById("navigation");

if (menuButton && navigation) {
    menuButton.addEventListener("click", function () {
        const isOpen = navigation.classList.toggle("open");
        menuButton.setAttribute("aria-expanded", String(isOpen));
        menuButton.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
    });

    navigation.querySelectorAll("a").forEach(function (link) {
        link.addEventListener("click", function () {
            navigation.classList.remove("open");
            menuButton.setAttribute("aria-expanded", "false");
            menuButton.setAttribute("aria-label", "Open navigation");
        });
    });
}

document.querySelectorAll("[data-current-year]").forEach(function (year) {
    year.textContent = new Date().getFullYear();
});

const contactForm = document.getElementById("contactForm");
const formMessage = document.getElementById("formMessage");

if (contactForm && formMessage) {
    contactForm.addEventListener("submit", function (event) {
        event.preventDefault();

        /* Replace YOUR_EMAIL_HERE with your real business email address. */
        const businessEmail = "YOUR_EMAIL_HERE";

        if (businessEmail === "YOUR_EMAIL_HERE") {
            formMessage.textContent = "Add your business email inside script.js before publishing.";
            return;
        }

        const name = document.getElementById("name").value;
        const business = document.getElementById("business").value;
        const customerEmail = document.getElementById("email").value;
        const service = document.getElementById("service").value;
        const message = document.getElementById("message").value;
        const subject = "SilverForge Project Request - " + service;

        const body =
            "Name: " + name + "\n" +
            "Business: " + business + "\n" +
            "Customer Email: " + customerEmail + "\n" +
            "Service: " + service + "\n\n" +
            "Project Details:\n" + message;

        window.location.href =
            "mailto:" + businessEmail +
            "?subject=" + encodeURIComponent(subject) +
            "&body=" + encodeURIComponent(body);

        formMessage.textContent = "Opening your email application...";
    });
}
