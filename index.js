const root = process.env.PWD;
require("pino-pretty");
const dotenv = require("dotenv");

dotenv.config({ path: ".env" });
const fastify = require("fastify")({
  logger: false,
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

fastify.register(require("fastify-jwt"), { secret: "supersecret" });
fastify.register(require("fastify-mongodb"), {
  forceClose: true,
  name: "authdb",
  url: uri,
});

fastify.register(require("fastify-auth"));
fastify.register(require("fastify-formbody"));
fastify.register(require("fastify-static"), {
  root: path.join(__dirname, "public"),
  prefix: "/", // optional: default '/'
});

fastify.register(require("fastify-secure-session"), {
  // the name of the session cookie, defaults to 'session'
  cookieName: "session",
  // adapt this to point to the directory where secret-key is located
  key: fs.readFileSync(path.join(__dirname, "secret-key")),
  cookie: {
    path: "/",
    // options for setCookie, see https://github.com/fastify/fastify-cookie
    secure: true,
    httpOnly: true,
    overwrite: true,
  },
});
fastify.register(fastifyFlash);
fastify.register(require("point-of-view"), {
  engine: {
    pug: require("pug"),
  },
  defaultContext: {},
  root: path.join(__dirname, "views"),
});
fastify.register(require("fastify-socket.io"), {
  // put your options here
});

const dukku = `${process.env.DOKKUHOST}`;

function admintest(user) {
  let admin = process.env.ADMINUSERNAME;
  if (user == admin) {
    return true;
  }
  return false;
}

async function verifypass(req, res, done) {
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

fastify.ready().then(async () => {
  fastify.io.on("connection", (socket) => {
    socket.on("deploysend", async (data) => {
      await sendCommand(`dokku apps:create ${data.appname}`);
      const clone = await spawn(`git clone ${data.github} ${data.appname}`, {
        cwd: "/home/harrison/nodejs/test/",
        shell: true,
        detached: false,
      });
      clone.stdout.on("data", (output) => {
        fastify.io.emit("deployout", output.toString());
        console.log(data.toString());
      });
      clone.stderr.on("data", (output) => {
        fastify.io.emit("deployout", output.toString());
        console.log(output.toString());
      });
      clone.on("exit", () => {
        fastify.io.emit("deployout", "finished");
        const remoteadd = exec(
          `git remote add dokku dokku@${process.env.DOKKUHOST}:${data.appname}`,
          {
            cwd: `/home/harrison/nodejs/test/${data.appname}/`,
            shell: true,
            detached: true,
          }
        );
        const deploy = spawn(`git push dokku main:master`, {
          cwd: `/home/harrison/nodejs/test/${data.appname}`,
          shell: true,
          detached: true,
        });
        deploy.stdout.on("data", (output) => {
          console.log(output.toString());
          fastify.io.emit("deployout", output.toString());
        });
        deploy.stderr.on("data", (output) => {
          fastify.io.emit("deployout", output.toString());
          console.log(output.toString());
        });
        deploy.on("exit", () => {
          const user = req.session.get("user");
          let entry = fastify.authdb.db
            .collections("users")
            .findOne({ user: user });
          entry.apps;
          fastify.io.emit("deployout", "Complete");
        });
      });
    });
  });
});

function sendCommand(command, sshkey) {
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

fastify.post("/setup", async function (req, res) {
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

fastify.get("/", async function (req, res) {
  let successes = req.session.get("successes");
  req.session.set("successes", "");
  let errors = req.session.get("errors");
  req.session.set("errors", "");
  if (process.env.SETUP == false || !process.env.SETUP) {
    res.view("setup");
  }
  let alive = await sendCommand("dokku version");
  console.log("test");
  res.view("index", {
    user: req.session.get("user"),
    admin: req.session.get("admin"),
    alive: alive,
    url: process.env.DOKKUHOST,
    errors: errors,
    successes: successes,
  });
});
fastify.get(
  "/main",
  {
    preValidation: [verifypass],
  },
  async function (req, res) {
    let successes = req.session.get("successes");
    req.session.set("successes", "");
    let errors = req.session.get("errors");
    req.session.set("errors", "");
    let alive = await sendCommand("dokku version");

    res.view("main", {
      user: req.session.get("user"),
      admin: admintest(req.session.get("user")),
      sucesses: successes,
      errors: errors,
      alive: alive,
    });
  }
);

fastify.post(
  "/deploy",
  {
    preValidation: [verifypass],
  },
  async function (req, res) {
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
        password: { type: "string" },
      },
      required: ["user", "password"],
    },
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
          apps: [],
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
  },
});

fastify.post("/login", async function (req, res) {
  const { user, password } = req.body;
  let userdb = await fastify.mongo.authdb.db
    .collection("users")
    .findOne({ user: user });
  let userdbpass = fastify.jwt.decode(userdb.token);
  if (userdb.user == user && userdbpass.password == password) {
    const token = await fastify.mongo.authdb.db
      .collection("users")
      .findOne({ user: user }).token;
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

fastify.get("/logout", async function (req, res) {
  let successes = req.session.get("successes");
  let errors = req.session.get("errors");
  req.session.delete();
  req.session.set("successes", successes);
  req.session.set("errors", errors);
  res.redirect("login");
});

fastify.get("/login", async function (req, res) {
  let successes = req.session.get("successes");
  req.session.set("successes", "");
  let errors = req.session.get("errors");
  req.session.set("errors", "");
  //let checkalive = await client.ping();
  let alive = await sendCommand("dokku version");
  res.view("login", {
    successes: successes,
    errors: errors,
    user: req.session.get("user"),
    alive: alive,
  });
});

fastify.get("/register", async function (req, res) {
  let successes = req.session.get("successes");
  req.session.set("successes", "");
  let errors = req.session.get("errors");
  req.session.set("errors", "");

  let alive = await sendCommand("dokku version");

  res.view("register", {
    successes: successes,
    errors: errors,
    user: req.session.get("user"),
    admin: req.session.get("admin"),
    alive: alive,
  });
});
process.on("SIGINT", function () {
  client.close();
  process.exit();
});

fastify.listen(process.env.PORT || 3000, "0.0.0.0", function (err, address) {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info(`server listening on ${address}`);
  console.log(`server running on ${address}`);
});
