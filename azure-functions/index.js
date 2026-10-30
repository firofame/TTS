"use strict";

const { app } = require("@azure/functions");
const { createSpeechHandlers } = require("./speech");
const { listVoices, synthesize } = createSpeechHandlers();

app.http("voices", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: listVoices,
});

app.http("speech", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: synthesize,
});
