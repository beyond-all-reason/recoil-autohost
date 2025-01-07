import { AutohostStartRequestData, Player, AllyTeam, Team, Bot } from 'tachyon-protocol/types';
import * as tdf from 'recoil-tdf';

export class StartScriptGenError extends Error {
	constructor(msg: string) {
		super(msg);
		this.name = 'StartScriptGenError';
	}
}

function shareKey(a: object, b: object): boolean {
	return Object.keys(a).some((k) => Object.hasOwn(b, k));
}

function mergeCustomOpts(
	o: tdf.TDFSerializable,
	p: { customProperties?: { [k: string]: string } },
): tdf.TDFSerializable {
	if (p.customProperties) {
		if (shareKey(o, p.customProperties)) {
			throw new StartScriptGenError(
				'customProperties must have different keys then outer object',
			);
		}
		o = { ...o, ...p.customProperties };
	}
	return o;
}

function buildAllyTeam(numAllyTeams: number, at: AllyTeam): tdf.TDFSerializable {
	let o: tdf.TDFSerializable = {};
	if (at.startBox) {
		o = {
			'StartRectTop': at.startBox.top,
			'StartRectLeft': at.startBox.left,
			'StartRectBottom': at.startBox.bottom,
			'StartRectRight': at.startBox.right,
		};
	}
	if (at.allies) {
		o['NumAllies'] = at.allies.length;
		for (let i = 0; i < at.allies.length; ++i) {
			if (at.allies[i] < 0 || at.allies[i] >= numAllyTeams) {
				throw new StartScriptGenError('Invalid ally referenced');
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
	if ((!team.players || team.players.length == 0) && (!team.bots || team.bots.length == 0)) {
		throw new StartScriptGenError('There must be at least one player or AI in each team');
	}
	const o: tdf.TDFSerializable = {
		'AllyTeam': allyTeamIdx,
		'TeamLeader': playersMap.get(team.players?.[0]?.userId ?? team.bots![0].hostUserId!)!,
	};
	if (team.advantage !== undefined) o['Advantage'] = team.advantage;
	if (team.incomeMultiplier !== undefined) o['IncomeMultiplier'] = team.incomeMultiplier;
	if (team.faction) o['Side'] = team.faction;
	if (team.color) o['RgbColor'] = `${team.color.r} ${team.color.g} ${team.color.b}`;
	if (team.startPos) {
		o['StartPosX'] = team.startPos.x;
		o['StartPosZ'] = team.startPos.y;
	}
	return mergeCustomOpts(o, team);
}

function buildPlayer(teamIdx: number | null, p: Player): tdf.TDFSerializable {
	const o: tdf.TDFSerializable = {
		'UserID': p.userId,
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

function buildAI(teamIdx: number, playersMap: Map<string, number>, ai: Bot): tdf.TDFSerializable {
	if (!playersMap.has(ai.hostUserId)) {
		throw new StartScriptGenError('AI hosted by not existing player');
	}
	const o: tdf.TDFSerializable = {
		'ShortName': ai.aiShortName,
		'Host': playersMap.get(ai.hostUserId)!,
		'Team': teamIdx,
	};
	if (ai.aiVersion) o['Version'] = ai.aiVersion;
	if (ai.name) o['Name'] = ai.name;
	if (ai.aiOptions) o['OPTIONS'] = ai.aiOptions;
	return mergeCustomOpts(o, ai);
}

export function scriptGameFromStartRequest(req: AutohostStartRequestData): {
	[k: string]: tdf.TDFSerializable | string | number | boolean;
} {
	let startPosType: number;
	switch (req.startPosType) {
		case 'fixed':
			startPosType = 0;
			break;
		case 'random':
			startPosType = 1;
			break;
		case 'ingame':
			startPosType = 2;
			break;
		case 'beforegame':
			startPosType = 3;
			break;
		default:
			throw new StartScriptGenError('Invalid startPosType');
	}
	const g: tdf.TDFSerializable = {
		'GameID': req.battleId,
		'GameType': req.gameName,
		'MapName': req.mapName,
		'ModHash': req.gameArchiveHash ?? '1',
		'MapHash': req.mapArchiveHash ?? '1',
		'StartPosType': startPosType,
		'MODOPTIONS': req.gameOptions ?? {},
		'MAPOPTIONS': req.mapOptions ?? {},
	};

	if (req.startDelay) g['GameStartDelay'] = req.startDelay;

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
	const playersMap = new Map(players.map((p, idx) => [p.userId, idx]));
	if (players.length != playersMap.size) {
		throw new StartScriptGenError('Player userIds must be unique');
	}
	if (players.length != new Set(players.map((p) => p.name)).size) {
		throw new StartScriptGenError('Player names must be unique');
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
			for (const ai of team.bots ?? []) {
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
