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
    let test = req.session.get("token");
    const mongo = fastify.mongo.authdb.db.collection("users");
    const user = req.session.get("user");
    let userdb = await mongo.findOne({ user }).token;
    if (test != userdb) {
      req.session.delete();
      req.session.set("errors", "BACK FROM WHENCE YOU CAME");
      res.redirect("/login");
    }
    done(); // pass an error if the authentication fails
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

      let successes = req.session.get("successes");
      req.session.set("successes", "");
      let errors = req.session.get("errors");
      req.session.set("errors", "");
      res.view("settings", {
        errors: errors,
        successes: successes,
        user: req.session.get("user"),
        admin: admintest(req.session.get("user")),
        alive: alive,
      });
    }
  );

  fastify.post(
    "/stopapp",
    {
      preValidation: [validate],
    },
    async function (req, res) {
      let { attempt, password, password2 } = req.body;
      let patch;

      if (password != password2) {
        req.session.set("errors", "Passwords don't match");
        res.redirect("/settings");
      } else {
        let name = req.session.get("user");

        const token = fastify.jwt.sign({ password });

        console.log(
          await fastify.mongo.authdb.db.collection("users").findOneAndUpdate(
            {
              user: name,
            },
            { $set: { token: token } },
            { upsert: true }
          )
        );
        req.session.delete();
        req.session.set(
          "successes",
          "Change Password Successful, Please Login Again"
        );
        res.redirect("/login");
      }
    }
  );

  fastify.post(
    "/pubkey",
    {
      preValidation: [validate],
    },
    async function (req, res) {
      let { pubkey } = req.body;
      const user = req.session.get("user");
      const dbentry = await fastify.mongo.authdb.db
        .collection("users")
        .findOne({ user: user });

      let name = req.session.get("user");

      await fastify.mongo.authdb.db.collection("users").findOneAndUpdate(
        {
          user: name,
        },
        { $set: { pubkey: pubkey } },
        { upsert: true }
      );
      console.log(dbentry.pubkeyname);

      sendCommand(`dokku ssh-keys:remove "${dbentry.pubkeyname}"`);
      sendCommand(
        `echo "${pubkey}" | dokku ssh-keys:add "${dbentry.pubkeyname}"`
      );
      req.session.set("successes", "Public key changed");
      res.redirect("/settings");
    }
  );

  fastify.post(
    "/delete",
    {
      preValidation: [validate],
    },
    async function (req, res) {}
  );
  done();
};
