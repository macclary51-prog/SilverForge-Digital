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

            const businessEmail =
                "silverforgedigitalsolutions@gmail.com";

            const endpoint =
                "https://formsubmit.co/ajax/" +
                businessEmail;

            const formData =
                new FormData(contactForm);

            const service =
                formData.get("service");

            const customerEmail =
                formData.get("email");

            const submitButton =
                contactForm.querySelector(
                    'button[type="submit"]'
                );

            const originalButtonText =
                submitButton.textContent;

            const submission = {
                name: formData.get("name"),

                business:
                    formData.get("business") ||
                    "Not provided",

                email: customerEmail,

                _replyto: customerEmail,

                service: service,

                message:
                    formData.get("message"),

                _subject:
                    "SilverForge Project Request - " +
                    service,

                _template: "table",

                _captcha: "false",

                _honey: ""
            };

            submitButton.disabled = true;

            submitButton.textContent =
                "Sending...";

            formMessage.textContent =
                "Sending your project request...";

            try {
                const response = await fetch(
                    endpoint,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json",

                            "Accept":
                                "application/json"
                        },

                        body:
                            JSON.stringify(
                                submission
                            )
                    }
                );

                const responseText =
                    await response.text();

                let result = null;

                try {
                    result =
                        JSON.parse(responseText);
                } catch (error) {
                    result = null;
                }

                const responseMessage =
                    result && result.message
                        ? String(result.message)
                        : responseText;

                const activationNeeded =
                    /activate|activation|confirm/i.test(
                        responseMessage
                    );

                const reportedFailure =
                    result &&
                    (
                        result.success === false ||
                        result.success === "false"
                    );

                if (
                    !response.ok ||
                    (
                        reportedFailure &&
                        !activationNeeded
                    )
                ) {
                    throw new Error(
                        responseMessage ||
                        "Form submission failed."
                    );
                }

                if (activationNeeded) {
                    formMessage.textContent =
                        "Check silverforgedigitalsolutions@gmail.com for the FormSubmit activation email. Click its activation link, then submit the form again.";
                } else {
                    formMessage.textContent =
                        "Thank you. Your project request was sent successfully.";

                    contactForm.reset();
                }
            } catch (error) {
                console.error(
                    "Quote form error:",
                    error
                );

                formMessage.textContent =
                    "The request could not be sent. Please try again or email silverforgedigitalsolutions@gmail.com directly.";
            } finally {
                submitButton.disabled = false;

                submitButton.textContent =
                    originalButtonText;
            }
        }
    );
}
