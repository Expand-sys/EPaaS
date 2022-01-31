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
socket.on("mainerrors", function (data) {
  window.location.replace("/mainerrors");
});
socket.on("trickery", function (data) {
  window.location.replace("/trickery");
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

document.getElementById("ssl").addEventListener("change", function () {
  document.getElementById("sslemail").required = this.checked;
});

async function destroy() {
  const user = document.getElementById("user").value;
  const app = event.target.value;
  socket.emit("destroy", {
    user: user,
    app: app,
  });
  await sleep(2000);
  await location.reload();
}
async function disablessl() {
  const user = document.getElementById("user").value;
  const app = event.target.value;
  socket.emit("disablessl", {
    email: sslemail,
    user: user,
    app: app,
  });
  await sleep(2000);
  await location.reload();
}
async function enablessl() {
  const user = document.getElementById("user").value;
  const app = event.target.value;
  socket.emit("enablessl", {
    email: sslemail,
    user: user,
    app: app,
  });
  await sleep(2000);
  await location.reload();
}

function deploy() {
  const user = document.getElementById("deploy").value;
  const github = document.getElementById("github").value;
  const appname = document.getElementById("appname").value;
  const ssl = document.getElementById("ssl").checked;
  const domain = document.getElementById("domain").value;
  const sslemail = document.getElementById("sslemail").value;
  const restart = document.getElementById("restart").checked;
  console.log(restart);
  console.log(ssl);
  socket.emit("deploysend", {
    github: github,
    appname: appname,
    session: user,
    restart: restart,
    ssl: ssl,
    domain: domain,
    sslemail: sslemail,
  });
}
