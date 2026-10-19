(function () {
  var params = new URLSearchParams(window.location.search);
  var target = "employeevoice://linkedin?code=" + encodeURIComponent(params.get("code") || "")
    + "&state=" + encodeURIComponent(params.get("state") || "")
    + "&error=" + encodeURIComponent(params.get("error") || "");
  window.location.replace(target);
})();
