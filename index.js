const root = process.env.PWD;
require("pino-pretty");
const dotenv = require("dotenv");

dotenv.config({ path: ".env" });
const fastify = require("fastify")({
  logger: false
});

const fastifyFlash = require("fastify-flash");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const got = require("got");
const { Client } = require("ssh2");
const fs = require("fs");
const events = require("events");
const uri = `mongodb+srv://${process.env.MONGODBUSR}:${process.env.MONGODBPW}@epaas.bfejg.mongodb.net/EPaaS?retryWrites=true&w=majority`;
const { exec, spawn } = require("child_process");
const util = require("util");
const execping = util.promisify(require("child_process").exec);
const sshexec = require("ssh2-exec");

fastify.register(require("fastify-jwt"), { secret: "supersecret" });
fastify.register(require("fastify-mongodb"), {
  forceClose: true,
  name: "authdb",
  url: uri
});

fastify.register(require("fastify-auth"));
fastify.register(require("fastify-formbody"));
fastify.register(require("fastify-static"), {
  root: path.join(__dirname, "public"),
  prefix: "/" // optional: default '/'
});

fastify.register(require("fastify-secure-session"), {
  cookieName: "session",
  key: fs.readFileSync(path.join(__dirname, "secret-key")),
  cookie: {
    path: "/",
    secure: process.env.SECURE,
    httpOnly: true,
    overwrite: true
  }
});
fastify.register(fastifyFlash);
fastify.register(require("point-of-view"), {
  engine: {
    pug: require("pug")
  },
  defaultContext: {},
  root: path.join(__dirname, "views")
});
fastify.register(require("fastify-socket.io"), {});

const dukku = `${process.env.DOKKUHOST}`;

const ping = async host => {
  const { stdout, stderr } = await execping(`ping -c 1 ${host}`);
  if (!stderr) {
    return true;
  } else return false;
};

function admintest(user) {
  let admin = process.env.ADMINUSERNAME;
  if (user == admin) {
    return true;
  }
  return false;
}

async function verifypass(req, res, done) {
  let test;
  let user;
  let userdb;
  try {
    test = req.session.get("token");
    user = req.session.get("user");
    const mongo = await fastify.mongo.authdb.db
      .collection("users")
      .findOne({ user });
    userdb = mongo.token;
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

fastify.ready().then(async () => {
  fastify.io.on("connection", socket => {
    socket.on("getlogs", async data => {
      user = data.user;
      const mongo = fastify.mongo.authdb.db.collection("users");
      userdb = await mongo.findOne({ user });
      if (data.token != userdb.token) {
        fastify.io.emit("trickery");
      } else {
        sendCommand(`dokku logs:vector-logs ${data.app} --tail`);
      }
    });
    socket.on("startcontainer", async data => {
      user = data.user;
      const mongo = fastify.mongo.authdb.db.collection("users");
      userdb = await mongo.findOne({ user });
      if (data.token != userdb.token) {
        fastify.io.emit("trickery");
      } else {
        await sendCommand(`dokku ps:start ${data.app}`);
      }
    });
    socket.on("stopcontainer", async data => {
      user = data.user;
      const mongo = fastify.mongo.authdb.db.collection("users");
      userdb = await mongo.findOne({ user });
      if (data.token != userdb.token) {
        fastify.io.emit("trickery");
      } else {
        await sendCommand(`dokku ps:stop ${data.app}`);
      }
    });
    socket.on("restartcontainer", async data => {
      user = data.user;
      const mongo = fastify.mongo.authdb.db.collection("users");
      userdb = await mongo.findOne({ user });
      if (data.token != userdb.token) {
        fastify.io.emit("trickery");
      } else {
        await sendCommand(`dokku ps:restart ${data.app}`);
      }
    });
    socket.on("enablessl", async data => {
      user = data.user;
      const mongo = fastify.mongo.authdb.db.collection("users");
      userdb = await mongo.findOne({ user });
      if (data.token != userdb.token) {
        fastify.io.emit("trickery");
      } else {
        await sendCommand(`dokku letsencrypt:enable ${data.appname}`);
      }
    });
    socket.on("disablessl", async data => {
      user = data.user;
      const mongo = fastify.mongo.authdb.db.collection("users");
      userdb = await mongo.findOne({ user });
      if (data.token != userdb.token) {
        fastify.io.emit("trickery");
      } else {
        await sendCommand(`dokku letsencrypt:disable ${data.appname}`);
      }
    });

    socket.on("destroy", async data => {
      user = data.user;
      const mongo = fastify.mongo.authdb.db.collection("users");
      userdb = await mongo.findOne({ user });
      if (data.token != userdb.token) {
        fastify.io.emit("trickery");
      } else {
        await sendCommand(`dokku --force apps:destroy ${data.app}`);
        console.log(data);
        const update = {
          $pull: { apps: data.app }
        };
        console.log(
          await fastify.mongo.authdb.db
            .collection("users")
            .findOneAndUpdate({ user: data.user }, update)
        );
      }
    });

    socket.on("deploysend", async data => {
      user = data.user;
      data.appname = data.appname.replaceAll(" ", "-");
      data.appname = data.appname.split(";")[0];
      data.github = data.github.split(" ")[0];
      data.github = data.github.split(";")[0];
      data.sslemail = data.sslemail.split(" ")[0];
      data.sslemail = data.sslemail.split(";")[0];
      data.domain = data.domain.split(" ")[0];
      data.domain = data.domain.split(";")[0];
      const mongo = fastify.mongo.authdb.db.collection("users");
      userdb = await mongo.findOne({ user });
      console.log(userdb);
      console.log(data.token);
      if (userdb.apps.length >= 4) {
        socket.emit("toomanyapps");
      }
      if (data.token != userdb.token) {
        fastify.io.emit("trickery");
      } else {
        if (!data.appname || !data.github) {
          socket.emit("mainerrors");
        } else if (data.ssl && !data.sslemail && !data.domain) {
          socket.emit("mainerrors");
        } else {
          try {
            console.log("here 1");
            //sendCommand(`rm -rf ${process.env.HOMEDIR}/${data.appname}`);
          } catch (e) {
            console.log(e);
          }
          if (data.database) {
            await sendCommand(
              `dokku ${data.database}:create ${data.appname}-db && dokku ${data.database}:link ${data.appname}-db ${data.appname}`
            );
          }
          if (
            (await sendCommand(`dokku apps:create ${data.appname}`)) == true
          ) {
            await fastify.io.emit(
              "deployout",
              "Stage 1 Finished - Create Application Entry"
            );
            if (
              (await sendCommand(`git clone ${data.github} ${data.appname}`)) ==
              true
            ) {
              await fastify.io.emit(
                "deployout",
                "Stage 2 Finished - Clone Git"
              );
              let userdb = await fastify.mongo.authdb.db
                .collection("users")
                .findOne({ user: data.user });
              console.log(userdb);
              if (
                (await sendCommand(
                  `dokku resource:limit --cpu 0.5 --memory 256m --memory-swap 512m ${data.appname}`
                )) == true
              ) {
                await fastify.io.emit(
                  "deployout",
                  "stage 3 Finished - Set Resource Limits"
                );
                await sendCommand(`dokku acl:add ${data.appname} Expand`);
                if (
                  await sendCommand(
                    `cd ~/${data.appname} && git remote add dokku dokku@${process.env.DOKKUHOST}:${data.appname}`
                  )
                ) {
                  await fastify.io.emit(
                    "deployout",
                    "Stage 4 Finished - Adding Remote"
                  );
                  if (
                    await sendCommand(
                      `cd ~/${data.appname} && git push dokku main:master`
                    )
                  ) {
                    await fastify.io.emit(
                      "deployout",
                      "Stage 5 Finished - Pushing & Deploying App"
                    );

                    const update = {
                      $addToSet: { apps: data.appname }
                    };
                    fastify.mongo.authdb.db
                      .collection("users")
                      .findOneAndUpdate({ user: data.user }, update, {
                        upsert: true
                      });
                    fastify.io.emit("deployout", "Complete");
                    if (data.domain) {
                      sendCommand(
                        `dokku domains:add ${data.appname} ${data.domain}`
                      );
                      fastify.io.emit(
                        "deployout",
                        `Please add a CNAME record from ${data.domain} to eu.epaas.cx or an A record to 162.55.100.40`
                      );
                      if (data.ssl) {
                        sendCommand(
                          `dokku domains:remove ${data.appname} ${data.appname}.epaas.cx`
                        );
                        sendCommand(
                          `dokku config:set --no-restart ${data.appname} DOKKU_LETSENCRYPT_EMAIL=${data.sslemail}`
                        );
                        sendCommand(`dokku letsencrypt:enable ${data.appname}`);
                      }
                      sendCommand(`rm -rf ${data.appname}`);
                    }
                  } else {
                    cleanup();
                  }
                } else {
                  cleanup();
                }
              }
            } else {
              cleanup();
            }
          } else {
            cleanup();
          }
        }
      }
    });
  });
});
async function cleanup(appname) {
  sendCommand(`dokku apps:destroy ${data.appname}`);
  sendCommand(`rm -rf ${data.appname}`);
}

async function sendCommand(command, username) {
  let output;
  const promise = new Promise(async (resolve, reject) => {
    if (!command.includes(";")) {
      console.log(command);
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
                  if (code <= 1) {
                    resolve(true);
                  } else {
                    resolve(false);
                  }
                  conn.end();
                })
                .on("data", data => {
                  console.log("STDOUT: " + data);
                  fastify.io.emit("deployout", "" + data);
                })
                .stderr.on("data", data => {
                  console.log("STDERR: " + data);
                  fastify.io.emit("deployout", "" + data);
                });
            });
          })
          .connect({
            host: `${process.env.DOKKUHOST}`,
            port: 22,
            username: `root`,
            privateKey: fs.readFileSync(`${process.env.HOMEDIR}/.ssh/id_rsa`)
          });
      } catch (err) {
        console.log(err);
        fastify.io.emit("offline");
      }
    } else {
      fastify.io.emit("data", "Nice Try Batman, Sanitizing input...");
      let newCommand = command.split(";")[0];
      console.log(newCommand);
    }
  });

  return promise;
  promise.catch(() => null);
}

fastify.post("/setup", async function(req, res) {
  const { url, secure } = req.body;
  if (secure) {
    process.env.SECURE = true;
  }
  process.env.DOKKUHOST = url;
  fs.rmSync(`${root}/.env`);
  fs.writeFileSync(
    `${root}/.env`,
    "DOKKUHOST=" +
      process.env.DOKKUHOST +
      "\n" +
      "SECURE=" +
      process.env.SECURE +
      "\nSETUP=true"
  );

  fs.writeFileSync(`${root}/tmp/restart.txt`, "");
  res.redirect("/");
});

fastify.get("/", async function(req, res) {
  let successes = req.session.get("successes");
  req.session.set("successes", "");
  let errors = req.session.get("errors");
  req.session.set("errors", "");
  if (process.env.SETUP == false || !process.env.SETUP) {
    res.view("setup");
  }
  let alive = await ping(`${process.env.DOKKUHOST}`);
  res.view("index", {
    user: req.session.get("user"),
    token: req.session.get("token"),
    admin: admintest(req.session.get("user")),
    online: alive,
    url: process.env.DOKKUHOST,
    errors: errors,
    successes: successes
  });
});
fastify.get(
  "/mainerrors",
  {
    preValidation: [verifypass]
  },
  async function(req, res) {
    req.session.set("successes", "");
    req.session.set("errors", "Please fill in fields");
    res.redirect("main");
  }
);

fastify.get(
  "/toomanyapps",
  {
    preValidation: [verifypass]
  },
  async function(req, res) {
    req.session.set("successes", "");
    req.session.set(
      "errors",
      "Too many applications already on your account, Sorry!"
    );
    res.redirect("main");
  }
);

fastify.get(
  "/main",
  {
    preValidation: [verifypass]
  },
  async function(req, res) {
    let successes = req.session.get("successes");
    req.session.set("successes", "");
    let errors = req.session.get("errors");
    req.session.set("errors", "");
    let alive = await ping(`${process.env.DOKKUHOST}`);
    res.view("main", {
      token: req.session.get("token"),
      user: req.session.get("user"),
      admin: admintest(req.session.get("user")),
      sucesses: successes,
      errors: errors,
      online: alive
    });
  }
);

fastify.post(
  "/deploy",
  {
    preValidation: [verifypass]
  },
  async function(req, res) {
    let { github, appname } = req.body;
    req.session.set("errors", "");
    req.session.set("successes", "");

    res.redirect("/main");
  }
);

fastify.route({
  method: "POST",
  url: "/register",
  schema: {
    body: {
      type: "object",
      properties: {
        user: { type: "string" },
        password: { type: "string" }
      },
      required: ["user", "password"]
    }
  },
  handler: async (req, reply) => {
    req.log.info("Creating new user");

    if (
      await fastify.mongo.authdb.db
        .collection("users")
        .findOne({ user: req.body.user })
    ) {
      req.session.set("errors", "User Already Exists");
      reply.redirect("/register");
    } else {
      if (req.body.password2 == req.body.password) {
        let password = req.body.password;
        const token = fastify.jwt.sign({ password });
        let keyname = uuidv4();

        fastify.mongo.authdb.db.collection("users").insertOne({
          user: req.body.user,
          token: token,
          pubkey: req.body.pubkey,
          pubkeyname: keyname,
          apps: []
        });
        await sendCommand(
          `echo ${req.body.pubkey} | dokku ssh-keys:add ${keyname}`
        );
        req.log.info("User created");
        req.session.set("token", token);
        req.session.set("successes", "User Created!");
        reply.redirect("/main");
      } else {
        req.session.set("errors", "Passwords dont match!");
        reply.redirect("/register");
      }
    }
  }
});

fastify.post("/login", async function(req, res) {
  const { user, password } = req.body;
  let userdb = await fastify.mongo.authdb.db
    .collection("users")
    .findOne({ user: user });
  let userdbpass = fastify.jwt.decode(userdb.token);
  if (userdb.user == user && userdbpass.password == password) {
    const db = await fastify.mongo.authdb.db
      .collection("users")
      .findOne({ user: user });
    const token = db.token;
    req.session.set("token", token);
    req.session.set("user", user);
  } else {
    req.session.set("errors", "Username or Password Wrong");
    res.redirect("/login");
  }
  res.redirect("/main");
});

fastify.register(require("./routes/admin"), { prefix: "/admin" });

fastify.register(require("./routes/settings"), { prefix: "/settings" });

fastify.register(require("./routes/apps"), { prefix: "/apps" });

fastify.get("/trickery", function(req, res) {
  req.session.delete();
  res.view("trickery");
});

fastify.get("/logout", async function(req, res) {
  let successes = req.session.get("successes");
  let errors = req.session.get("errors");
  req.session.delete();
  req.session.set("successes", successes);
  req.session.set("errors", errors);
  res.redirect("login");
});

fastify.get("/login", async function(req, res) {
  let successes = req.session.get("successes");
  req.session.set("successes", "");
  let errors = req.session.get("errors");
  req.session.set("errors", "");
  //let checkalive = await client.ping();
  let alive = await ping(`${process.env.DOKKUHOST}`);
  res.view("login", {
    successes: successes,
    errors: errors,
    user: req.session.get("user"),
    online: alive
  });
});

fastify.get("/register", async function(req, res) {
  let successes = req.session.get("successes");
  req.session.set("successes", "");
  let errors = req.session.get("errors");
  req.session.set("errors", "");

  let alive = await ping(`${process.env.DOKKUHOST}`);

  res.view("register", {
    successes: successes,
    errors: errors,
    user: req.session.get("user"),
    admin: req.session.get("admin"),
    online: alive
  });
});
process.on("SIGINT", function() {
  process.exit();
});

fastify.listen(process.env.PORT || 3000, "0.0.0.0", function(err, address) {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`server listening on ${address}`);
  console.log(`server running on ${address}`);
});
