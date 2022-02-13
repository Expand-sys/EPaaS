var socket = io("http://localhost:3000");

socket.on("deployout", function(data) {
  const node = document.createElement("LI");
  const textnode = document.createTextNode(`${data}`);
  node.appendChild(textnode);
  document.getElementById("console").appendChild(node);
  console.log(data.toString());
});

socket.on("mainerrors", function(data) {
  window.location.replace("/mainerrors");
});
socket.on("trickery", function(data) {
  window.location.replace("/trickery");
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

document.getElementById("ssl").addEventListener("change", function() {
  document.getElementById("sslemail").required = this.checked;
});

async function getlogs() {
  const app = event.target.value;
  const user = document.getElementById("user").value;
  const token = document.getElementById("token").value;
  socket.emit("getlogs", {
    app: app,
    token: token,
    user: user
  });
}

async function destroy() {
  const user = document.getElementById("user").value;
  const token = document.getElementById("token").value;
  const app = event.target.value;
  socket.emit("destroy", {
    user: user,
    app: app,
    token: token
  });
  await sleep(2000);
  await location.reload();
}

async function startcontainer() {
  const user = document.getElementById("user").value;
  const token = document.getElementById("token").value;
  const app = event.target.value;
  socket.emit("startcontainer", {
    user: user,
    app: app,
    token: token
  });
  await sleep(2000);
  await location.reload();
}
async function stopcontainer() {
  const user = document.getElementById("user").value;
  const token = document.getElementById("token").value;
  const app = event.target.value;
  socket.emit("stopcontainer", {
    user: user,
    app: app,
    token: token
  });
  await sleep(2000);
  await location.reload();
}
async function restartcontainer() {
  const user = document.getElementById("user").value;
  const token = document.getElementById("token").value;
  const app = event.target.value;
  socket.emit("restartcontainer", {
    user: user,
    app: app,
    token: token
  });
  await sleep(2000);
  await location.reload();
}

async function disablessl() {
  const user = document.getElementById("user").value;
  const token = document.getElementById("token").value;
  const app = event.target.value;
  socket.emit("disablessl", {
    email: sslemail,
    user: user,
    app: app,
    token: token
  });
  await sleep(2000);
  await location.reload();
}
async function enablessl() {
  const user = document.getElementById("user").value;
  const token = document.getElementById("token").value;
  const app = event.target.value;
  socket.emit("enablessl", {
    email: sslemail,
    user: user,
    app: app,
    token: token
  });
  await sleep(2000);
  await location.reload();
}

function deploy() {
  const user = document.getElementById("user").value;
  const token = document.getElementById("token").value;
  const github = document.getElementById("github").value;
  const appname = document.getElementById("appname").value;
  const ssl = document.getElementById("ssl").checked;
  const domain = document.getElementById("domain").value;
  const sslemail = document.getElementById("sslemail").value;
  const database = document.getElementById("database").value;
  socket.emit("deploysend", {
    token: token,
    github: github,
    appname: appname,
    user: user,
    ssl: ssl,
    domain: domain,
    sslemail: sslemail,
    database: database
  });
}
