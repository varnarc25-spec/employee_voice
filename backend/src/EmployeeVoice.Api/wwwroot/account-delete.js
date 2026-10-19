const status = document.querySelector("#status");
const requestForm = document.querySelector("#request-form");
const confirmForm = document.querySelector("#confirm-form");
const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");

if (token) {
  requestForm.hidden = true;
  confirmForm.hidden = false;
}

requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Sending…";
  const response = await fetch("/api/v1/account/deletion-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ email: document.querySelector("#email").value })
  });
  const body = await response.json();
  status.textContent = body.message || body.detail || "Request received.";
});

confirmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Deleting…";
  const response = await fetch("/api/v1/account/deletion-requests/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ token })
  });
  const body = await response.json();
  status.textContent = body.message || body.detail || "Done.";
});
