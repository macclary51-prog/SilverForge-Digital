// LDG menu fix v2

document.addEventListener("DOMContentLoaded", function () {
  const navToggle = document.getElementById("navToggle");
  const navLinks = document.getElementById("navLinks");

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", function () {
      navLinks.classList.toggle("open");
    });

    document.querySelectorAll(".nav-links a").forEach(function (link) {
      link.addEventListener("click", function () {
        navLinks.classList.remove("open");
      });
    });
  }

  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  document.querySelectorAll(".nav-links a").forEach(function (link) {
    const href = link.getAttribute("href");

    link.classList.remove("active");

    if (href === currentPage) {
      link.classList.add("active");
    }

    if ((currentPage === "" || currentPage === "/") && href === "index.html") {
      link.classList.add("active");
    }
  });
});