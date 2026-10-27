// ============================================================================
//  GEGK Adventure — SOUND CONFIG
//  This is the one file to edit when you want to swap in your own sounds.
//
//  * Paths are relative to /assets/audio/.
//  * To replace a sound, drop your file in assets/audio/sfx (or music) and
//    point the entry at it. .ogg, .mp3 and .wav all work.
//  * Entries set to null (or pointing at a missing file) fall back to a
//    generated Web Audio chiptune placeholder, listed in docs/MISSING_ASSETS.md.
// ============================================================================
'use strict';

G.SoundConfig = {
  // ---- Engine sound effects (used by menus, battles and the overworld) ----
  sfx: {
    cursor:        'sfx/GUI sel cursor.ogg',
    select:        'sfx/GUI sel decision.ogg',
    cancel:        'sfx/GUI sel cancel.ogg',
    buzzer:        'sfx/GUI sel buzzer.ogg',
    menuOpen:      'sfx/GUI menu open.ogg',
    menuClose:     'sfx/GUI menu close.ogg',
    save:          'sfx/GUI save choice.ogg',
    partySwitch:   'sfx/GUI party switch.ogg',
    summaryPage:   'sfx/GUI summary change page.ogg',
    pokedexOpen:   'sfx/GUI pokedex open.ogg',
    trainerCard:   'sfx/GUI trainer card open.ogg',
    doorEnter:     'sfx/Door enter.ogg',
    doorExit:      'sfx/Door exit.ogg',
    bump:          'sfx/Player bump.ogg',
    jump:          'sfx/Player jump.ogg',
    exclaim:       'sfx/Exclaim.ogg',
    pcOn:          'sfx/PC open.ogg',
    pcOff:         'sfx/PC close.ogg',
    pcAccess:      'sfx/PC access.ogg',
    buy:           'sfx/Mart buy item.ogg',
    useItem:       'sfx/Use item in party.ogg',
    repel:         'sfx/Repel.ogg',
    cut:           'sfx/Cut.ogg',
    rockSmash:     'sfx/Rock Smash.ogg',
    strength:      'sfx/Strength push.ogg',
    fly:           'sfx/Fly.ogg',
    bicycle:       'sfx/Bicycle.ogg',
    warp:          null,                      // no warp-tile sound in the kit
    // battle
    hitNormal:     'sfx/Battle damage normal.ogg',
    hitSuper:      'sfx/Battle damage super.ogg',
    hitWeak:       'sfx/Battle damage weak.ogg',
    faint:         'sfx/Pkmn faint.ogg',
    expGain:       'sfx/Pkmn exp gain.ogg',
    expFull:       'sfx/Pkmn exp full.ogg',
    levelUp:       'sfx/Pkmn level up.ogg',
    moveLearnt:    'sfx/Pkmn move learnt.ogg',
    ballThrow:     'sfx/Battle throw.ogg',
    ballHit:       'sfx/Battle ball hit.ogg',
    ballDrop:      'sfx/Battle ball drop.ogg',
    ballShake:     'sfx/Battle ball shake.ogg',
    ballClick:     'sfx/Battle catch click.ogg',
    sendOut:       'sfx/Battle jump to ball.ogg',
    recall:        'sfx/Battle recall.ogg',
    flee:          'sfx/Battle flee.ogg',
    statUp:        null,                      // placeholder chiptune
    statDown:      null,                      // placeholder chiptune
    lowHp:         null,                      // placeholder chiptune
    encounter:     'sfx/Vs flash.ogg',
  },

  // ---- Short jingles ("ME") played over the music ----
  me: {
    heal:          'music/me/Pkmn healing.ogg',
    itemGet:       'music/me/Obtained an Item.ogg',
    keyItemGet:    'music/me/Obtained a Key Item.ogg',
    tmGet:         'music/me/Machine get.ogg',
    badgeGet:      'music/me/Obtained a Badge.ogg',
    pkmnGet:       'music/me/Pkmn get.ogg',
    catchSuccess:  'music/me/Battle capture success.ogg',
    evolutionStart:'music/me/Evolution start.ogg',
    evolutionDone: 'music/me/Evolution success.ogg',
    save:          'music/me/GUI save game.ogg',
  },

  // ---- Music used by the engine itself ----
  music: {
    title:          'music/Title.ogg',
    wildBattle:     'music/Battle (Wild Pokémon).ogg',
    trainerBattle:  'music/Battle (Trainer).ogg',
    gymBattle:      'music/Battle (Gym Leader).ogg',
    rivalBattle:    'music/Final Battle (Rival).ogg',
    championBattle: 'music/Final Battle (Rival).ogg',
    wildVictory:    'music/Victory (Wild Pokémon).ogg',
    trainerVictory: 'music/Victory (Trainer).ogg',
    gymVictory:     'music/Victory (Gym Leader).ogg',
    evolution:      'music/Evolution.ogg',
    surf:           null,                     // "Surfing" isn't in the kit
    bicycle:        'music/Cycling.ogg',
    hallOfFame:     'music/Hall of Fame.ogg',
    credits:        'music/Epilogue.ogg',
  },

  // ---- Names used by the story scripts that don't match a file name ----
  // (the maps ask for these by name; map them to files you have)
  aliases: {
    'Pokémon Healed':           'music/me/Pkmn healing.ogg',
    'Surfing':                  null,
    'Bicycle':                  'music/Cycling.ogg',
    'Eyes Meet (Bug Catcher)':  "music/Trainers' Eyes Meet (Boy).ogg",
    'Eyes Meet (Hiker)':        "music/Trainers' Eyes Meet (Boy).ogg",
    'Eyes Meet (Lass)':         "music/Trainers' Eyes Meet (Girl).ogg",
    'Eyes Meet (Cooltrainer)':  "music/Trainers' Eyes Meet (Boy).ogg",
    'Eyes Meet (Rocket)':       "music/Trainers' Eyes Meet (Team Rocket).ogg",
    'Eyes Meet (Swimmer)':      "music/Trainers' Eyes Meet (Girl).ogg",
    'Eyes Meet (Tuber)':        "music/Trainers' Eyes Meet (Girl).ogg",
    'Ball Throw':               'sfx/Battle throw.ogg',
    'Ball Shake':               'sfx/Battle ball shake.ogg',
    // Missing from the kit -> chiptune placeholders until you add files:
    'Poké Flute':               null,
    'Pewter Museum':            null,
    'Route 12':                 null,
    'Saffron City':             null,
    'Seafoam Island Cave':      null,
    'Warp Tile 1':              null,
    'Warp Tile 2':              null,
  },

  // Volume (0..1) applied on top of the in-game volume options.
  musicVolume: 0.55,
  sfxVolume: 0.8,
};
