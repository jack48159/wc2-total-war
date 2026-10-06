// Scene registry + URL hash routing. To add a screen: write the Scene class, import it here, add one line to SCENES
// (and, if it should be reachable by URL, one case to routeFromHash).
import { E } from '../core/index.js';
import { Home } from './home.js';
import { SandboxMenu as Sandbox } from './sandbox_menu.js';
import { SandboxEditor } from './sandbox_editor.js';
import { Campaign } from './campaign.js';
import { CampaignList } from './campaign_list.js';
import { Conquest } from './conquest.js';
import { CountrySelect } from './country_select.js';
import { MatchSetup } from './match_setup.js';
import { Commander } from './commander.js';
import { Options } from './options.js';
import { SaveScreen } from './save_screen.js';
import { Bank } from './bank.js';
import { Battle } from './battle/battle.js';
import { Multiplayer } from './multiplayer.js';

export const SCENES = { home: Home, sandbox: Sandbox, sandboxEditor: SandboxEditor, campaign: Campaign, campaignList: CampaignList, conquest: Conquest, countrySelect: CountrySelect, matchSetup: MatchSetup,
  commander: Commander, options: Options, saveScreen: SaveScreen, bank: Bank, battle: Battle, multiplayer: Multiplayer };

E.registerScenes(SCENES);

// '#battle/battle_axis1' -> [sceneName, ...constructor args]
export function routeFromHash(hash = location.hash) {
  const [name, arg, section] = (hash || '').slice(1).split('/');
  switch (name) {
    case 'battle': return section ? ['battle', arg || 'battle_axis1', null, { liveGameId: section }] : ['battle', arg || 'battle_axis1'];
    case 'campaign': return ['campaign'];
    case 'battles': return ['campaignList', arg || 'axis'];
    case 'load': return ['saveScreen', null, 'load', 'campaign'];
    case 'conquest': return ['conquest'];
    case 'sandbox': return ['sandbox'];
    case 'countries': return ['countrySelect', /^\d+$/.test(arg || '') ? +arg : (arg || 1)];
    case 'commander': return ['commander'];
    case 'multiplayer': return ['multiplayer', arg || null, { stayInRoom: section === 'info' }];
    case 'options': return ['options'];
    case 'ai': return ['options', 'takeover'];
    default: return ['home'];
  }
}
