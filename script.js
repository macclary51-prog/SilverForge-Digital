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

const contactForm =
    document.getElementById("contactForm");

const formMessage =
    document.getElementById("formMessage");

if (contactForm && formMessage) {
    const allowedServices = new Set([
        "App Development",
        "Website Development",
        "Social Media Management",
        "Content and Video Creation",
        "Digital Advertising",
        "Multiple Services"
    ]);

    const honeypot =
        document.createElement("input");

    honeypot.type = "text";
    honeypot.name = "_honey";
    honeypot.tabIndex = -1;
    honeypot.autocomplete = "off";

    honeypot.setAttribute(
        "aria-hidden",
        "true"
    );

    honeypot.style.position = "absolute";
    honeypot.style.left = "-9999px";

    contactForm.appendChild(honeypot);

    contactForm.addEventListener(
        "submit",
        async function (event) {
            event.preventDefault();

            if (!contactForm.checkValidity()) {
                contactForm.reportValidity();
                return;
            }

            if (honeypot.value) {
                return;
            }

            const formData =
                new FormData(contactForm);

            const name = String(
                formData.get("name") || ""
            ).trim();

            const business = String(
                formData.get("business") || ""
            ).trim();

            const email = String(
                formData.get("email") || ""
            ).trim();

            const phone = String(
                formData.get("phone") || ""
            ).trim();

            const service = String(
                formData.get("service") || ""
            ).trim();

            const message = String(
                formData.get("message") || ""
            ).trim();

            if (
                !name ||
                !business ||
                !email ||
                !phone ||
                !message ||
                !allowedServices.has(service)
            ) {
                formMessage.textContent =
                    "Complete every required field before sending your request.";

                return;
            }

            const submitButton =
                contactForm.querySelector(
                    'button[type="submit"]'
                );

            const originalButtonText =
                submitButton.textContent;

            submitButton.disabled = true;

            submitButton.textContent =
                "Sending...";

            formMessage.textContent =
                "Sending your project request...";

            try {
                const [firebase, firestore] =
                    await Promise.all([
                        import("./firebase-config.js"),
                        import(
                            "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js"
                        )
                    ]);

                if (
                    !firebase.isFirebaseConfigured ||
                    !firebase.db
                ) {
                    throw new Error(
                        "Firebase configuration is incomplete."
                    );
                }

                await firestore.addDoc(
                    firestore.collection(
                        firebase.db,
                        "leads"
                    ),
                    {
                        name,
                        business,
                        email,
                        phone,
                        service,
                        message,
                        status: "new",
                        quoteAmount: null,
                        followUpDate: "",
                        internalNotes: "",
                        createdAt:
                            firestore.serverTimestamp(),
                        updatedAt:
                            firestore.serverTimestamp()
                    }
                );

                formMessage.textContent =
                    "Thank you. Your project request was sent successfully.";

                contactForm.reset();
            } catch (error) {
                console.error(
                    "Quote form error:",
                    error
                );

                formMessage.textContent =
                    "The request could not be sent. Please try again in a moment.";
            } finally {
                submitButton.disabled = false;

                submitButton.textContent =
                    originalButtonText;
            }
        }
    );
}
