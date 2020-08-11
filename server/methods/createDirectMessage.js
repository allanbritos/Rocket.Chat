import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';

import { settings } from '../../app/settings';
import { hasPermission, hasRole } from '../../app/authorization';
import { Users, Rooms } from '../../app/models';
import { RateLimiter } from '../../app/lib';
import { addUser } from '../../app/federation/server/functions/addUser';
import { createRoom } from '../../app/lib/server';

Meteor.methods({
	createDirectMessage(...usernames) {
		check(usernames, [String]);

		if (!Meteor.userId()) {
			throw new Meteor.Error('error-invalid-user', 'Invalid user', {
				method: 'createDirectMessage',
			});
		}

		const me = Meteor.user();

		if (!me.username) {
			throw new Meteor.Error('error-invalid-user', 'Invalid user', {
				method: 'createDirectMessage',
			});
		}

		if (settings.get('Message_AllowDirectMessagesToYourself') === false && usernames.length === 1 && me.username === usernames[0]) {
			throw new Meteor.Error('error-invalid-user', 'Invalid user', {
				method: 'createDirectMessage',
			});
		}

		const users = usernames.filter((username) => username !== me.username).map((username) => {
			let to = Users.findOneByUsernameIgnoringCase(username);

			// CHECK IF USER IS ADMIN,HR OR IT (SERVICE DEPARTMENTS)
			if (!Meteor.userId() === 'rocket.cat') {
				if (!hasRole(Meteor.userId(), 'admin' || !hasRole(Meteor.userId(), 'hr') || !hasRole(Meteor.userId(), 'it'))) {
					// USER IS NOT, SO LET'S CHECK IF BOTH ARE IN THE SAME LOB (LOB SET AS A ROLE)
					const rs = ['admin', 'user', 'staff', 'moderator', 'leader', 'owner', 'bot', 'app', 'agent', 'anonymous', 'livechat-agent', 'livechat-manager'];
					let me_c = me.roles;
					let to_c = to.roles;
					let allowed = false;

					me_c = me_c.filter(function(el) {
						return rs.indexOf(el) < 0;
					});
					to_c = to_c.filter(function(el) {
						return rs.indexOf(el) < 0;
					});
					me_c.forEach(function(item) {
						if (!allowed) {
							allowed = to_c.indexOf(item) >= 0;
						}
					});

					if (!allowed) {
						throw new Meteor.Error('error-not-allowed', `Not allowed: ${ Meteor.userId() }`, {
							method: 'createDirectMessage',
						});
					}
				}
			}

			// If the username does have an `@`, but does not exist locally, we create it first
			if (!to && username.indexOf('@') !== -1) {
				to = addUser(username);
			}

			if (!to) {
				throw new Meteor.Error('error-invalid-user', 'Invalid user', {
					method: 'createDirectMessage',
				});
			}
			return to;
		});

		if (!hasPermission(Meteor.userId(), 'create-d')) {
			// If the user can't create DMs but can access already existing ones
			if (hasPermission(Meteor.userId(), 'view-d-room')) {
				// Check if the direct room already exists, then return it

				const uids = [me, ...users].map(({ _id }) => _id).sort();
				const room = Rooms.findOneDirectRoomContainingAllUserIDs(uids, { fields: { _id: 1 } });
				if (room) {
					return {
						t: 'd',
						rid: room._id,
						...room,
					};
				}
			}

			throw new Meteor.Error('error-not-allowed', 'Not allowed', {
				method: 'createDirectMessage',
			});
		}

		const { _id: rid, inserted, ...room } = createRoom('d', null, null, [me, ...users], null, { }, { creator: me._id });

		return {
			t: 'd',
			rid,
			...room,
		};
	},
});

RateLimiter.limitMethod('createDirectMessage', 10, 60000, {
	userId(userId) {
		return !hasPermission(userId, 'send-many-messages');
	},
});
