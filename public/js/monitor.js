var socket = io("http://localhost:3000");
socket.on("online", function () {
  console.log(`online`);
  document.getElementById("monitor").style.display = "visible";
  document.getElementById("monitordead").style.display = "none";
});

socket.on("offline", function () {
  console.log(`offline`);
  document.getElementById("monitor").style.display = "none";
  document.getElementById("monitordead").style.display = "visible";
});
socket.on("deployout", function (data) {
  const node = document.createElement("LI");
  const textnode = document.createTextNode(`${data}`);
  node.appendChild(textnode);
  document.getElementById("console").appendChild(node);
  console.log(data.toString());
});

function deploy() {
  const user = document.getElementById("submit").value;
  const github = document.getElementById("github").value;
  const appname = document.getElementById("appname").value;
  socket.emit("deploysend", {
    github: github,
    appname: appname,
    session: user,
  });
}

function updateScroll() {
  var element = document.getElementById("output");
  element.scrollTop = element.scrollHeight;
}
setInterval(updateScroll, 50);
