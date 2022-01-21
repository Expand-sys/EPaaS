var socket = io();
socket.on('online', function () {
  console.log(`online`)
  document.getElementById('monitor').style.display = "visible";
  document.getElementById('monitordead').style.display = "none";
})

socket.on('offline', function () {
  console.log(`offline`)
  document.getElementById('monitor').style.display = "none";
  document.getElementById('monitordead').style.display = "visible";
})
