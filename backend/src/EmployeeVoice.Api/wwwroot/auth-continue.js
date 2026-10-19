const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") || "";
const input = document.querySelector("#token");
const status = document.querySelector("#status");
input.value = token;
document.querySelector("#copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(token);
    status.textContent = "Copied.";
  } catch {
    status.textContent = "Select the token and copy it manually.";
  }
});
