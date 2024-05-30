import { StartRequest, Player, AllyTeam, Team, AI } from './types/startRequest.js';
import StartRequestSchema from './schemas/startRequest.json' assert { type: 'json' };
import * as tdf from 'recoil-tdf';

function shareKey(a: object, b: object): boolean {
	return Object.keys(a).some((k) => Object.hasOwn(b, k));
}

function mergeCustomOpts(
	o: tdf.TDFSerializable,
	p: { customOpts?: { [k: string]: string } },
): tdf.TDFSerializable {
	if (p.customOpts) {
		if (shareKey(o, p.customOpts)) {
			throw new Error('customOpts must have different keys then outer object');
		}
		o = { ...o, ...p.customOpts };
	}
	return o;
}

function buildAllyTeam(numAllyTeams: number, at: AllyTeam): tdf.TDFSerializable {
	let o: tdf.TDFSerializable = {};
	if (at.startbox) {
		o = {
			'StartRectTop': at.startbox.top,
			'StartRectLeft': at.startbox.left,
			'StartRectBottom': at.startbox.bottom,
			'StartRectRight': at.startbox.right,
		};
	}
	if (at.allies) {
		o['NumAllies'] = at.allies.length;
		for (let i = 0; i < at.allies.length; ++i) {
			if (at.allies[i] < 0 || at.allies[i] >= numAllyTeams) {
				throw new Error('Invalid ally referenced');
			}
			o[`Ally${i}`] = at.allies[i];
		}
	}
	return mergeCustomOpts(o, at);
}

function buildTeam(
	allyTeamIdx: number,
	playersMap: Map<string, number>,
	team: Team,
): tdf.TDFSerializable {
	if ((!team.players || team.players.length == 0) && (!team.ais || team.ais.length == 0)) {
		throw new Error('There must be at least one player or AI in each team');
	}
	const o: tdf.TDFSerializable = {
		'AllyTeam': allyTeamIdx,
		'TeamLeader': playersMap.get(team.players?.[0]?.name ?? team.ais![0].hostPlayer!)!,
	};
	if (team.advantage !== undefined) o['Advantage'] = team.advantage;
	if (team.incomeMultiplier !== undefined) o['IncomeMultiplier'] = team.incomeMultiplier;
	if (team.side) o['Side'] = team.side;
	if (team.color) o['RgbColor'] = `${team.color.r} ${team.color.g} ${team.color.b}`;
	if (team.startPos) {
		o['StartPosX'] = team.startPos.x;
		o['StartPosZ'] = team.startPos.z;
	}
	return mergeCustomOpts(o, team);
}

function buildPlayer(teamIdx: number | null, p: Player): tdf.TDFSerializable {
	const o: tdf.TDFSerializable = {
		'Name': p.name,
		'Password': p.password,
	};
	if (teamIdx === null) {
		o['Spectator'] = 1;
	} else {
		o['Team'] = teamIdx;
	}
	if (p.countryCode !== undefined) o['CountryCode'] = p.countryCode;
	if (p.rank !== undefined) o['Rank'] = p.rank;
	return mergeCustomOpts(o, p);
}

function buildAI(teamIdx: number, playersMap: Map<string, number>, ai: AI): tdf.TDFSerializable {
	if (!playersMap.has(ai.hostPlayer)) {
		throw new Error('AI hosted by not existing player');
	}
	const o: tdf.TDFSerializable = {
		'ShortName': ai.shortName,
		'Host': playersMap.get(ai.hostPlayer)!,
		'Team': teamIdx,
	};
	if (ai.version) o['Version'] = ai.version;
	if (ai.name) o['Name'] = ai.name;
	if (ai.options) o['OPTIONS'] = ai.options;
	return o;
}

export function scriptGameFromStartRequest(req: StartRequest): {
	[k: string]: tdf.TDFSerializable | string | number | boolean;
} {
	const g: tdf.TDFSerializable = {
		'GameID': req.gameUUID,
		'GameType': req.modName,
		'MapName': req.mapName,
		'ModHash': req.modHash ?? '1',
		'MapHash': req.mapHash ?? '1',
		'StartPosType': StartRequestSchema.properties.startPosType.enum.findIndex(
			(v) => v == req.startPosType,
		),
		'MODOPTIONS': req.modOptions ?? {},
		'MAPOPTIONS': req.mapOptions ?? {},
	};

	if (req.gameStartDelay) g['GameStartDelay'] = req.gameStartDelay;

	if (req.restrictions) {
		const o: tdf.TDFSerializable = {};
		let numRestrictions = 0;
		for (const [unit, value] of Object.entries(req.restrictions)) {
			o[`Unit${numRestrictions}`] = unit;
			o[`Limit${numRestrictions}`] = value;
			++numRestrictions;
		}
		g['NumRestrictions'] = numRestrictions;
		g['RESTRICT'] = o;
	}

	// We build the playersMap early here so that we can easily lookup
	// players by their name in the loop below.
	const players = req.allyTeams
		.flatMap((at) => at.teams)
		.flatMap((t) => t.players ?? [])
		.concat(req.spectators ?? []);
	const playersMap = new Map(players.map((p, idx) => [p.name, idx]));
	if (players.length != playersMap.size) {
		throw new Error('Player names must be unique');
	}

	let teamIdx = 0;
	let playerIdx = 0;
	let aiIdx = 0;
	for (let atIdx = 0; atIdx < req.allyTeams.length; ++atIdx) {
		const at = req.allyTeams[atIdx];
		g[`ALLYTEAM${atIdx}`] = buildAllyTeam(req.allyTeams.length, at);
		for (const team of at.teams) {
			g[`TEAM${teamIdx}`] = buildTeam(atIdx, playersMap, team);
			for (const p of team.players ?? []) {
				g[`PLAYER${playerIdx++}`] = buildPlayer(teamIdx, p);
			}
			for (const ai of team.ais ?? []) {
				g[`AI${aiIdx++}`] = buildAI(teamIdx, playersMap, ai);
			}
			++teamIdx;
		}
	}

	for (const p of req.spectators ?? []) {
		g[`PLAYER${playerIdx++}`] = buildPlayer(null, p);
	}

	g['NumAllyTeams'] = req.allyTeams.length;
	g['NumTeams'] = teamIdx;
	g['NumPlayers'] = playerIdx;

	return g;
}
