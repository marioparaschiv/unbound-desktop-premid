import Plugin from '@entities/plugin';

import { Users } from '@webpack/stores';
import { findByProps } from '@webpack';
import * as Toasts from '@api/toasts';
import { createServer } from 'http';
import { noop } from '@utilities';
import Socket from 'socket.io';

import { Client } from './constants';

const [
   { SET_ACTIVITY },
   HTTP
] = findByProps(
   ['SET_ACTIVITY'],
   ['get', 'post', 'put'],
   { bulk: true }
);

export default class extends Plugin {
   public server: ReturnType<typeof createServer>;
   public socket: InstanceType<typeof Socket.Server>;
   public applications = {};

   start() {
      this.server = createServer();
      this.socket = new Socket.Server(this.server, {
         serveClient: false,
         allowEIO3: true,
         cors: { origin: '*' }
      });

      this.socket.on('connection', this.#onConnect.bind(this));
      this.server.on('error', (error) => {
         if ((error as any).code === 'EADDRINUSE') {
            this.logger.error('Port 3020 is already bound.');

            Toasts.open({
               title: 'PreMiD',
               icon: 'Close',
               color: 'var(--info-danger-foreground)',
               content: 'Port 3020 is already bound. Make sure you close any other instances of Discord and/or PreMiD.'
            });
         } else {
            this.logger.error(error);
         }
      });

      this.server.listen(3020, () => this.logger.debug('Listening on port 3020'));
   }

   async stop() {
      if (this.socket && this.server) {
         this.#clear();

         await this.socket?.close();
         this.server?.close();
      }
   }

   #onConnect(connection) {
      // Versioning
      connection.on('getVersion', () => connection.emit('receiveVersion', '220'));

      // Provide PreMiD with information about the current user
      const user = Users.getCurrentUser();
      connection.emit('discordUser', user);

      // Activity handlers
      connection.on('setActivity', this.#set.bind(this));
      connection.on('clearActivity', this.#clear.bind(this));
      connection.on('selectLocalPresence', noop);

      connection.once('disconnect', () => this.logger.debug('Socket Disconnected.'));
   }

   async #set(message) {
      const payload = message.presenceData;

      const activity: Record<string, any> = {
         details: payload.details ?? '',
         state: payload.state ?? '',
         buttons: payload.buttons ?? []
      };

      if (payload.startTimestamp || payload.endTimestamp) {
         activity.timestamps = {};

         if (payload.startTimestamp) {
            activity.timestamps.start = payload.startTimestamp;
         }

         if (payload.endTimestamp) {
            activity.timestamps.end = payload.endTimestamp;
         }
      }

      if (payload.largeImageKey) {
         activity.assets = {
            large_image: payload.largeImageKey,
            small_image: payload.smallImageKey,
            small_text: payload.smallImageText
         };
      }

      activity.name = this.applications[message.clientId] ?? 'PreMiD';

      if (!this.applications[message.clientId]) {
         const data = await HTTP.get({ url: `/applications/${message.clientId}/public?with_guild=false` });

         activity.name = data.body.name;
         this.applications[message.clientId] = activity.name;
      }

      SET_ACTIVITY.handler({
         isSocketConnected: () => true,
         socket: {
            id: 100,
            application: {
               id: message.clientId,
               name: activity.name
            },
            encoding: 'json',
            transport: 'ipc',
            version: 1
         },
         args: {
            pid: 10,
            activity
         }
      });
   }

   #clear() {
      this.logger.debug('Clearing activity');

      // Pass an empty payload to the handler, clearing any current activity from PreMiD
      SET_ACTIVITY.handler({
         isSocketConnected: () => true,
         socket: {
            id: 100,
            application: Client,
            encoding: 'json',
            transport: 'ipc',
            version: 1
         },
         args: {
            pid: 10,
            activity: undefined
         }
      });
   }
}