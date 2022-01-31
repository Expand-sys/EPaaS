const root = process.env.PWD;
const path = require("path");
const pug = require("pug");

const got = require("got");
const { Client } = require("ssh2");
const fs = require("fs");

const api = process.env.BANKAPIURL;
function admintest(user) {
  let admin = process.env.ADMINUSERNAME;
  if (user == admin) {
    return true;
  }
  return false;
}

module.exports = function (fastify, opts, done) {
  async function validate(req, res, done) {
    let test;
    let user;
    let userdb;
    try {
      test = req.session.get("token");
      user = req.session.get("user");
      const mongo = fastify.mongo.authdb.db.collection("users");
      userdb = await mongo.findOne({ user });
      userdb = userdb.token;
    } catch (e) {
      console.log(e);
    }

    if (test == undefined || test != userdb) {
      req.session.delete();
      req.session.set("errors", "BACK FROM WHENCE YOU CAME");
      res.redirect("/login");
      throw "fail";
    }
    done();
  }

  function sendCommand(command) {
    let output;
    const conn = new Client();
    try {
      conn
        .on("ready", () => {
          console.log("SSH Client Ready");
          conn.exec(`${command}`, (err, stream) => {
            if (err) throw err;
            stream
              .on("close", (code, signal) => {
                console.log(
                  "Stream :: close :: code: " + code + ", signal: " + signal
                );
                conn.end();
              })
              .on("data", (data) => {
                console.log("STDOUT: " + data);
                fastify.io.emit("online");
                fastify.io.emit("data", data);
              })
              .stderr.on("data", (data) => {
                console.log("STDERR: " + data);
                fastify.io.emit("offline");
                fastify.io.emit("error", data);
              });
          });
        })
        .connect({
          host: `${process.env.DOKKUHOST}`,
          port: 22,
          username: `root`,
          privateKey: fs.readFileSync("/home/harrison/.ssh/id_rsa"),
        });
    } catch (err) {
      console.log(err);
      fastify.io.emit("offline");
    }
  }

  fastify.get(
    "/",
    {
      preValidation: [validate],
    },
    async function (req, res) {
      let alive = await sendCommand("dokku version");
      let user = req.session.get("user");
      const apps = await fastify.mongo.authdb.db
        .collection("users")
        .findOne({ user: user });
      console.log(apps);
      let successes = req.session.get("successes");
      req.session.set("successes", "");
      let errors = req.session.get("errors");
      req.session.set("errors", "");
      secret = fastify.jwt.sign({ user });

      res.view("apps", {
        secret: secret,
        apps: apps.apps,
        errors: errors,
        successes: successes,
        user: req.session.get("user"),
        admin: admintest(req.session.get("user")),
        alive: alive,
      });
    }
  );

  done();
};
