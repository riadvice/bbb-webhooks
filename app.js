/* eslint-disable-next-line no-unused-vars */
import { NODE_CONFIG_DIR, SUPPRESS_NO_CONFIG_WARNING } from "./src/common/env.js";
import config from 'config';
import Application from './application.js';
import logger from './src/common/logger.js';
import { init as initErrorTracking } from './src/common/error-tracking.js';

initErrorTracking('bbb-webhooks', { logger, config: config.sentry });

const application = new Application();
application.start();
