import './src/common/telemetry.js';
/* eslint-disable-next-line no-unused-vars */
import { NODE_CONFIG_DIR, SUPPRESS_NO_CONFIG_WARNING } from "./src/common/env.js";
// eslint-disable-next-line no-unused-vars
import config from 'config';

const { default: Application } = await import('./application.js');

const application = new Application();
application.start();
