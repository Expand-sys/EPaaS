const root = process.env.PWD;
const path = require("path");
var pug = require("pug");

const got = require("got");
async function validate(req, res, done) {
  let test = req.session.get("token");
  console.log(`test output ${test}`);
  const level = this.level.authdb;
  console.log("here");
  let userdb = await level.get(req.session.get("user"));
  console.log(`userdb ${userdb}`);
  if (test != userdb) {
    req.session.delete();
    req.session.set("errors", "BACK FROM WHENCE YOU CAME");
    res.redirect("/login");
  }
  done(); // pass an error if the authentication fails
}

const api = process.env.BANKAPIURL;

module.exports = function (fastify, opts, done) {
  fastify.get(
    "/",
    {
      preValidation: [validate],
    },
    async function (req, res) {
      let alive = await sendCommand("version");

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
    "/pass",
    {
      preValidation: [validate],
    },
    async function (req, res) {
      let { attempt, new_pass, password2 } = req.body;
      let patch;

      if (attempt == undefined) {
        attempt = "";
      } else if (!new_pass || !password2) {
        req.session.set("errors", "please fill in all fields");
        res.redirect("/settings");
      } else if (new_pass != password2) {
        req.session.set("errors", "Passwords don't match");
        res.redirect("/settings");
      } else {
        try {
          let name = req.session.get("user");
        } catch (e) {
          console.log(e);
          req.session.set("errors", `${e.response.body}`);
          console.log(e.response.body);
        }

        console.log(patch);
        if (patch == -2) {
          req.session.set("errors", "Password Wrong");
          res.redirect("/settings");
        } else {
          req.session.delete();
          req.session.set(
            "successes",
            "Change Password Successful, Please Login Again"
          );
          res.redirect("/login");
        }
      }
    }
  );

  fastify.post(
    "/delete",
    {
      preValidation: [validate],
    },
    async function (req, res) {
      let { password, password2 } = req.body;
      let del;
      if (!password || !password2) {
        req.session.set("errors", "please fill in all fields");
        res.redirect("/settings");
      } else if (
        password != password2 &&
        password != req.session.get("password")
      ) {
        req.session.set("errors", "Passwords don't match");
        res.redirect("/settings");
      } else {
        let name = req.session.get("user");
        let auth = btoa(`${name}:${password}`);
        auth = `Basic ${auth}`;
        try {
          del = await got.delete(`${api}user/delete`, {
            headers: {
              Authorization: auth,
              Accept: "application/json",
            },
          });
        } catch (e) {
          req.session.set("errors", `${e.response.body}`);
          console.log(e.response.body);
        }

        console.log(del);
        if (del) {
          req.session.delete();
          req.session.set(
            "successes",
            "Account Deleted, pls dont come back to complain"
          );
        }
        res.redirect("/");
      }
    }
  );

  done();
};
