// Overworld characters (Essentials' Game_Character): tile movement, move
// routes, jumping, walking animation and drawing.
'use strict';

G.Character = class Character {
  constructor(map) {
    this.map = map;
    this.id = 0;
    this.x = 0; this.y = 0;
    this.realX = 0; this.realY = 0;          // pixels (16 per tile)
    this.width = 1; this.height = 1;
    this.tileId = 0;
    this.characterName = '';
    this.hue = 0;
    this.opacity = 255;
    this.blend = 0;
    this.direction = 2;
    this.pattern = 0; this.originalPattern = 0; this.originalDirection = 2;
    this.prelockDirection = 0;
    this.moveRouteForcing = false;
    this.through = false;
    this.animeCount = 0;
    this.stopCount = 0;
    this.moveType = 0;
    this.moveSpeed = 3;
    this.moveFrequency = 6;
    this.moveRoute = null;
    this.moveRouteIndex = 0;
    this.originalMoveRoute = null;
    this.walkAnime = true;
    this.stepAnime = false;
    this.dirFix = false;
    this.onTop = false;
    this.transparent = false;
    this.locked = false;
    this.waitTime = 0;
    this.moveTimer = null;
    this.jumpTimer = null;
    this.jumpPeak = 0;
    this.jumpFraction = 0;
    this.bushDepth = 0;
    this.lockPattern = false;
    this.movedLastFrame = false; this.movedThisFrame = false;
    this.stoppedLastFrame = false; this.stoppedThisFrame = false;
    this.setMoveSpeed(3);
    this.setMoveFrequency(6);
  }

  // ------------------------------------------------------------- settings
  setMoveSpeed(v) {
    this.moveSpeed = v;
    this.moveTime = v === 6 ? 0.05 : v === 5 ? 0.1 : 2 / Math.pow(2, v);
  }
  setJumpSpeed(v) { this.jumpTime = v === 6 ? 0.05 : v === 5 ? 0.1 : 2 / Math.pow(2, v); }
  setMoveFrequency(v) {
    this.moveFrequency = v;
    this.commandDelay = ((40 - v * 2) * (6 - v)) / 40;
  }
  patternUpdateSpeed() {
    if (this.jumping()) return (this.jumpTime || 0.25) * 2;
    let r = this.moveTime * 2;
    if (this.moveSpeed >= 5) r *= 2;
    return r;
  }
  moving() { return this.moveTimer !== null; }
  jumping() { return this.jumpTimer !== null; }
  atCoordinate(x, y) { return x >= this.x && x < this.x + this.width && y > this.y - this.height && y <= this.y; }
  inLineWith(x, y) {
    if (x >= this.x && x < this.x + this.width) return true;
    if (y > this.y - this.height && y <= this.y) return true;
    return false;
  }
  lock() {
    if (this.locked) return;
    this.prelockDirection = 0;
    this.turnTowardPlayer();
    this.locked = true;
  }
  unlock() {
    if (!this.locked) return;
    this.locked = false;
    if (!this.dirFix && this.prelockDirection !== 0) this.direction = this.prelockDirection;
  }
  straighten() {
    if (this.walkAnime || this.stepAnime) this.pattern = 0;
    this.animeCount = 0;
    this.prelockDirection = 0;
  }
  get player() { return G.Game.playerChar; }

  // ---------------------------------------------------------- map queries
  terrainTag() { return this.map.terrainTag(this.x, this.y); }
  calculateBushDepth() {
    if (this.tileId > 0 || this.onTop || this.jumping()) { this.bushDepth = 0; return; }
    const m = this.map;
    if (m.valid(this.x, this.y) && m.deepBush(this.x, this.y)) {
      if (this.moving()) {
        const bx = this.x - G.U.dx(this.direction), by = this.y - G.U.dy(this.direction);
        if (m.valid(bx, by) && m.deepBush(bx, by)) this.bushDepth = 16;
      } else this.bushDepth = 16;
    } else if (m.valid(this.x, this.y) && m.bush(this.x, this.y) && !this.moving()) this.bushDepth = 6;
    else this.bushDepth = 0;
  }

  passable(x, y, d, strict = false) {
    const nx = x + G.U.dx(d), ny = y + G.U.dy(d);
    if (!this.map.valid(nx, ny)) return false;
    if (this.through) return true;
    if (strict) {
      if (!this.map.passableStrict(x, y, d, this)) return false;
      if (!this.map.passableStrict(nx, ny, 10 - d, this)) return false;
    } else {
      if (!this.map.passable(x, y, d, this)) return false;
      if (!this.map.passable(nx, ny, 10 - d, this)) return false;
    }
    for (const ev of Object.values(this.map.events)) {
      if (ev === this || !ev.atCoordinate(nx, ny) || ev.through) continue;
      if (!this.isPlayer || ev.characterName !== '') return false;
    }
    const p = this.player;
    if (p && p.map === this.map && p.x === nx && p.y === ny && !p.through && this.characterName !== '') return false;
    return true;
  }
  canMoveFrom(sx, sy, dir, strict = false) {
    switch (dir) {
      case 2: case 8: {
        const yd = dir === 8 ? this.height - 1 : 0;
        for (let i = sx; i < sx + this.width; i++) if (!this.passable(i, sy - yd, dir, strict)) return false;
        return true;
      }
      case 4: case 6: {
        const xd = dir === 6 ? this.width - 1 : 0;
        for (let i = sy - this.height + 1; i <= sy; i++) if (!this.passable(sx + xd, i, dir, strict)) return false;
        return true;
      }
      case 1: case 3: {
        for (let i = sx; i < sx + this.width; i++) if (!this.passable(i, sy, 2, strict)) return false;
        const xd = dir === 3 ? this.width - 1 : 0;
        for (let i = sy - this.height + 1; i <= sy; i++) if (!this.passable(sx + xd, i + 1, dir + 3, strict)) return false;
        return true;
      }
      case 7: case 9: {
        const xd = dir === 9 ? this.width - 1 : 0;
        for (let i = sy - this.height + 1; i <= sy; i++) if (!this.passable(sx + xd, i, dir - 3, strict)) return false;
        const xo = dir === 9 ? 1 : -1;
        for (let i = sx; i < sx + this.width; i++) if (!this.passable(i + xo, sy - this.height + 1, 8, strict)) return false;
        return true;
      }
    }
    return false;
  }
  canMove(dir, strict) { return this.canMoveFrom(this.x, this.y, dir, strict); }

  // ------------------------------------------------------------- movement
  moveto(x, y) {
    this.x = x; this.y = y;
    this.realX = x * 16; this.realY = y * 16;
    this.prelockDirection = 0;
    this.calculateBushDepth();
  }
  forceMoveRoute(route) {
    if (!this.originalMoveRoute) {
      this.originalMoveRoute = this.moveRoute;
      this.originalMoveRouteIndex = this.moveRouteIndex;
    }
    this.moveRoute = route;
    this.moveRouteIndex = 0;
    this.moveRouteForcing = true;
    this.prelockDirection = 0;
    this.waitTime = 0;
    this.moveTypeCustom();
  }
  increaseSteps() { this.stopCount = 0; }
  startMove(nx, ny) {
    this.moveInitialX = this.x; this.moveInitialY = this.y;
    this.x = nx; this.y = ny;
    this.moveTimer = 0;
    this.increaseSteps();
  }
  moveGeneric(dir, turn = true) {
    if (turn) this.turnGeneric(dir);
    if (this.canMove(dir)) {
      this.turnGeneric(dir);
      this.startMove(this.x + G.U.dx(dir), this.y + G.U.dy(dir));
    } else this.checkEventTriggerTouch(dir);
  }
  moveDiagonal(dir) {
    if (!this.dirFix) {
      const h = dir === 7 || dir === 1 ? 4 : 6, v = dir === 7 || dir === 9 ? 8 : 2;
      if (this.direction === 10 - h) this.direction = h;
      else if (this.direction === 10 - v) this.direction = v;
    }
    if (this.canMove(dir)) this.startMove(this.x + (dir === 7 || dir === 1 ? -1 : 1), this.y + (dir === 7 || dir === 9 ? -1 : 1));
  }
  checkEventTriggerTouch() {}
  moveRandom() { this.moveGeneric([2, 4, 6, 8][G.U.rand(4)], false); }
  moveRandomRange(xr = -1, yr = -1) {
    const dirs = [];
    const ox = this.originalX ?? this.x, oy = this.originalY ?? this.y;
    if (xr < 0) dirs.push(4, 6);
    else if (xr > 0) { if (this.x > ox - xr) dirs.push(4); if (this.x < ox + xr) dirs.push(6); }
    if (yr < 0) dirs.push(2, 8);
    else if (yr > 0) { if (this.y < oy + yr) dirs.push(2); if (this.y > oy - yr) dirs.push(8); }
    if (dirs.length) this.moveGeneric(G.U.pick(dirs), false);
  }
  playerDelta() {
    const p = this.player;
    const px = p.x + (p.map.ox - this.map.ox), py = p.y + (p.map.oy - this.map.oy);
    const sx = this.x + this.width / 2 - (px + 0.5);
    const sy = this.y - this.height / 2 - (py - 0.5);
    return [sx, sy];
  }
  moveTowardPlayer() {
    const [sx, sy] = this.playerDelta();
    if (sx === 0 && sy === 0) return;
    let ax = Math.abs(sx), ay = Math.abs(sy);
    if (ax === ay) { if (G.U.rand(2)) ax++; else ay++; }
    if (ax > ay) {
      this.moveGeneric(sx > 0 ? 4 : 6);
      if (!this.moving() && sy !== 0) this.moveGeneric(sy > 0 ? 8 : 2);
    } else {
      this.moveGeneric(sy > 0 ? 8 : 2);
      if (!this.moving() && sx !== 0) this.moveGeneric(sx > 0 ? 4 : 6);
    }
  }
  moveAwayFromPlayer() {
    const [sx, sy] = this.playerDelta();
    if (sx === 0 && sy === 0) return;
    let ax = Math.abs(sx), ay = Math.abs(sy);
    if (ax === ay) { if (G.U.rand(2)) ax++; else ay++; }
    if (ax > ay) {
      this.moveGeneric(sx > 0 ? 6 : 4);
      if (!this.moving() && sy !== 0) this.moveGeneric(sy > 0 ? 2 : 8);
    } else {
      this.moveGeneric(sy > 0 ? 2 : 8);
      if (!this.moving() && sx !== 0) this.moveGeneric(sx > 0 ? 6 : 4);
    }
  }
  moveForward() { this.moveGeneric(this.direction, false); }
  moveBackward() {
    const fix = this.dirFix;
    this.dirFix = true;
    this.moveGeneric(10 - this.direction, false);
    this.dirFix = fix;
  }
  jump(xp, yp) {
    if (xp !== 0 || yp !== 0) {
      if (Math.abs(xp) > Math.abs(yp)) this.turnGeneric(xp < 0 ? 4 : 6);
      else this.turnGeneric(yp < 0 ? 8 : 2);
      for (let i = this.x; i < this.x + this.width; i++)
        for (let j = this.y - this.height + 1; j <= this.y; j++)
          if (!this.through && !this.jumpPassable(i + xp, j + yp)) return false;
    }
    this.jumpInitialX = this.x; this.jumpInitialY = this.y;
    this.x += xp; this.y += yp;
    this.jumpTimer = 0;
    const real = Math.sqrt(xp * xp + yp * yp);
    this.jumpPeak = Math.max(1, real) * 16 * 3 / 8;
    this.jumpFraction = 0;
    this.increaseSteps();
    return true;
  }
  jumpPassable(x, y) {
    if (!this.map.valid(x, y)) return false;
    if (!this.map.passable(x, y, 0, this) && !this.isPlayer) return false;
    for (const ev of Object.values(this.map.events)) if (ev !== this && !ev.through && ev.characterName && ev.atCoordinate(x, y)) return false;
    return true;
  }
  jumpForward(dist = 1) {
    const ox = this.x, oy = this.y;
    this.jump(G.U.dx(this.direction) * dist, G.U.dy(this.direction) * dist);
    return this.x !== ox || this.y !== oy;
  }
  turnGeneric(dir) {
    if (this.dirFix) return;
    const old = this.direction;
    this.direction = dir;
    this.stopCount = 0;
    if (dir !== old) this.onTurned();
  }
  onTurned() {}
  turnRight90() { this.turnGeneric({ 2: 4, 4: 8, 6: 2, 8: 6 }[this.direction]); }
  turnLeft90() { this.turnGeneric({ 2: 6, 4: 2, 6: 8, 8: 4 }[this.direction]); }
  turn180() { this.turnGeneric(10 - this.direction); }
  turnTowardPlayer() {
    const [sx, sy] = this.playerDelta();
    if (sx === 0 && sy === 0) return;
    if (Math.abs(sx) > Math.abs(sy)) this.turnGeneric(sx > 0 ? 4 : 6);
    else this.turnGeneric(sy > 0 ? 8 : 2);
  }
  turnAwayFromPlayer() {
    const [sx, sy] = this.playerDelta();
    if (sx === 0 && sy === 0) return;
    if (Math.abs(sx) > Math.abs(sy)) this.turnGeneric(sx > 0 ? 6 : 4);
    else this.turnGeneric(sy > 0 ? 2 : 8);
  }

  // Runs move route commands (RMXP codes 1-45).
  moveTypeCustom() {
    if (this.jumping() || this.moving() || !this.moveRoute) return;
    const list = this.moveRoute.list;
    if (!list.length) {
      if (this.moveRouteForcing) this.endForcedRoute();
      return;
    }
    for (let guard = 0; guard < list.length + 1; guard++) {
      let cmd = list[this.moveRouteIndex];
      if (!cmd) {
        if (this.moveRoute.repeat) { this.moveRouteIndex = 0; cmd = list[0]; }
        else { if (this.moveRouteForcing) this.endForcedRoute(); this.stopCount = 0; return; }
      }
      const [code, p] = cmd;
      if (code <= 14) {
        switch (code) {
          case 1: this.moveGeneric(2); break;
          case 2: this.moveGeneric(4); break;
          case 3: this.moveGeneric(6); break;
          case 4: this.moveGeneric(8); break;
          case 5: this.moveDiagonal(1); break;
          case 6: this.moveDiagonal(3); break;
          case 7: this.moveDiagonal(7); break;
          case 8: this.moveDiagonal(9); break;
          case 9: this.moveRandom(); break;
          case 10: this.moveTowardPlayer(); break;
          case 11: this.moveAwayFromPlayer(); break;
          case 12: this.moveForward(); break;
          case 13: this.moveBackward(); break;
          case 14: this.jump(p[0], p[1]); break;
        }
        if (this.moveRoute.skippable || this.moving() || this.jumping()) this.moveRouteIndex++;
        return;
      }
      if (code <= 26) {
        switch (code) {
          case 15: this.waitTime = G.time + p[0] / 20; break;
          case 16: this.turnGeneric(2); break;
          case 17: this.turnGeneric(4); break;
          case 18: this.turnGeneric(6); break;
          case 19: this.turnGeneric(8); break;
          case 20: this.turnRight90(); break;
          case 21: this.turnLeft90(); break;
          case 22: this.turn180(); break;
          case 23: G.U.rand(2) ? this.turnRight90() : this.turnLeft90(); break;
          case 24: this.turnGeneric([2, 4, 6, 8][G.U.rand(4)]); break;
          case 25: this.turnTowardPlayer(); break;
          case 26: this.turnAwayFromPlayer(); break;
        }
        this.moveRouteIndex++;
        return;
      }
      switch (code) {
        case 27: G.Game.switches.set(p[0], true); this.map.needRefresh = true; break;
        case 28: G.Game.switches.set(p[0], false); this.map.needRefresh = true; break;
        case 29: this.setMoveSpeed(p[0]); break;
        case 30: this.setMoveFrequency(p[0]); break;
        case 31: this.walkAnime = true; break;
        case 32: this.walkAnime = false; break;
        case 33: this.stepAnime = true; break;
        case 34: this.stepAnime = false; break;
        case 35: this.dirFix = true; break;
        case 36: this.dirFix = false; break;
        case 37: this.through = true; break;
        case 38: this.through = false; break;
        case 39: this.onTop = true; break;
        case 40: this.onTop = false; break;
        case 41:
          this.tileId = 0;
          this.characterName = p[0];
          this.hue = p[1];
          if (this.originalDirection !== p[2]) { this.direction = p[2]; this.originalDirection = p[2]; this.prelockDirection = 0; }
          if (this.originalPattern !== p[3]) { this.pattern = p[3]; this.originalPattern = p[3]; }
          if (p[0]) G.Assets.load(G.Assets.character(p[0]));
          break;
        case 42: this.opacity = p[0]; break;
        case 43: this.blend = p[0]; break;
        case 44: G.Audio.playSE(p[0]); break;
        case 45: {
          const s = String(p[0]);
          G.Bridge.moveRouteScript(this, s);
          if (/^move_random_(range|UD|LR)/.test(s)) { this.moveRouteIndex++; return; }
          break;
        }
      }
      this.moveRouteIndex++;
    }
  }
  endForcedRoute() {
    this.moveRouteForcing = false;
    this.moveRoute = this.originalMoveRoute;
    this.moveRouteIndex = this.originalMoveRouteIndex || 0;
    this.originalMoveRoute = null;
  }

  // ---------------------------------------------------------------- update
  update() {
    const dt = G.dt;
    this.movedLastFrame = this.movedThisFrame;
    this.stoppedLastFrame = this.stoppedThisFrame;
    this.movedThisFrame = false;
    this.stoppedThisFrame = false;
    this.updateCommand();
    if (this.moving() || this.jumping()) this.updateMove(dt);
    else this.updateStop(dt);
    this.updatePattern();
  }
  updateCommand() {
    if (this.waitTime) {
      if (G.time < this.waitTime) return;
      this.waitTime = 0;
    }
    if (this.moveRouteForcing) this.moveTypeCustom();
    else if (!this.starting && !this.locked && !this.moving() && !this.jumping()) this.updateCommandNew();
  }
  updateCommandNew() {
    if (this.stopCount >= this.commandDelay) {
      if (this.moveType === 1) {
        const r = G.U.rand(6);
        if (r <= 3) this.moveRandom(); else if (r === 4) this.moveForward(); else this.stopCount = 0;
      } else if (this.moveType === 2) {
        const [sx, sy] = this.playerDelta();
        if (Math.abs(sx) + Math.abs(sy) >= 20) { this.moveRandom(); return; }
        const r = G.U.rand(6);
        if (r <= 3) this.moveTowardPlayer(); else if (r === 4) this.moveRandom(); else this.moveForward();
      } else if (this.moveType === 3) this.moveTypeCustom();
    }
  }
  updateMove(dt) {
    if (this.moveTimer !== null) {
      this.moveTimer += dt;
      if (this.x !== this.moveInitialX) {
        const dist = Math.abs(this.moveInitialX - this.x);
        this.realX = G.U.lerp(this.moveInitialX, this.x, Math.min(1, this.moveTimer / (this.moveTime * dist))) * 16;
      }
      if (this.y !== this.moveInitialY) {
        const dist = Math.abs(this.moveInitialY - this.y);
        this.realY = G.U.lerp(this.moveInitialY, this.y, Math.min(1, this.moveTimer / (this.moveTime * dist))) * 16;
      }
    } else if (this.jumpTimer !== null) {
      if (!this.jumpTime) this.setJumpSpeed(3);
      this.jumpTimer += dt;
      const dist = Math.max(1, Math.abs(this.x - this.jumpInitialX), Math.abs(this.y - this.jumpInitialY));
      const t = Math.min(1, this.jumpTimer / (this.jumpTime * dist));
      if (this.x !== this.jumpInitialX) this.realX = G.U.lerp(this.jumpInitialX, this.x, t) * 16;
      if (this.y !== this.jumpInitialY) this.realY = G.U.lerp(this.jumpInitialY, this.y, t) * 16;
      this.jumpFraction = this.jumpTimer / (this.jumpTime * dist);
    }
    if (Math.abs(this.realX - this.x * 16) < 0.5) this.realX = this.x * 16;
    if (Math.abs(this.realY - this.y * 16) < 0.5) this.realY = this.y * 16;
    if (this.moving() && this.moveTimer >= this.moveTime && this.realX === this.x * 16 && this.realY === this.y * 16) {
      this.moveTimer = null;
      this.bumping = false;
    }
    if (this.jumping() && this.jumpFraction >= 1) {
      this.jumpTimer = null; this.jumpPeak = 0; this.jumpFraction = 0;
      this.landedJump = true;
      this.realX = this.x * 16; this.realY = this.y * 16;
    }
    if (!this.jumping() && !this.moving()) {
      this.onStepTaken();
      this.stepEffects();
      this.calculateBushDepth();
      this.stoppedThisFrame = true;
    } else if (!this.movedLastFrame || this.stoppedLastFrame) this.calculateBushDepth();
    if (this.walkAnime || this.stepAnime) this.animeCount += dt;
    this.movedThisFrame = true;
  }
  onStepTaken() {}
  // Essentials' step effects: grass rustles when stepping onto grass, dust
  // puffs when landing a jump. Bumping into a wall isn't a step.
  stepEffects() {
    const landed = this.landedJump;
    this.landedJump = false;
    if (this.x === this.lastStepX && this.y === this.lastStepY && !landed) return;
    this.lastStepX = this.x; this.lastStepY = this.y;
    const m = this.map;
    if (!m || !G.MapScene || this.transparent || (!this.characterName && !this.isPlayer)) return;
    if (!m.valid(this.x, this.y)) return;
    if (landed) G.MapScene.playMapAnimation(2, m, this.x, this.y);
    else if (G.Terrain.showsGrassRustle(m.terrainTag(this.x, this.y, true))) G.MapScene.playMapAnimation(1, m, this.x, this.y);
  }
  updateStop(dt) {
    if (this.stepAnime) this.animeCount += dt;
    if (!this.starting && !this.locked) this.stopCount += dt;
  }
  updatePattern() {
    if (this.lockPattern) return;
    if (this.movedLastFrame && !this.movedThisFrame && !this.stepAnime) {
      this.pattern = this.originalPattern; this.animeCount = 0; return;
    }
    if (!this.movedLastFrame && this.movedThisFrame && !this.stepAnime) {
      if (this.walkAnime) this.pattern = (this.pattern + 1) % 4;
      this.animeCount = 0; return;
    }
    const pt = this.patternUpdateSpeed() / 4;
    if (this.animeCount < pt) return;
    this.pattern = (this.pattern + 1) % 4;
    this.animeCount -= pt;
  }

  // ---------------------------------------------------------------- draw
  // Screen position of the tile the character stands on (top-left).
  screenPos(cam) {
    let sx = Math.round(this.map.ox * 16 + this.realX - cam.x);
    let sy = Math.round(this.map.oy * 16 + this.realY - cam.y);
    return [sx, sy];
  }
  zIndex(cam) {
    if (this.onTop) return 99999;
    const [, sy] = this.screenPos(cam);
    const ground = sy + 16;
    if (this.tileId > 0) return ground + this.map.priority(this.tileId) * 16;
    const img = this.characterName ? G.Assets.get(G.Assets.character(this.characterName)) : null;
    return ground + (img && img.height / 4 > 16 ? 15 : 0) + (this.isPlayer ? 1 : 0);
  }
  draw(ctx, cam) {
    if (this.transparent || this.opacity <= 0) return;
    let [sx, sy] = this.screenPos(cam);
    if (sx < -48 || sy < -48 || sx > G.Config.WIDTH + 48 || sy > G.Config.HEIGHT + 48) return;
    if (this.jumping()) {
      const jp = Math.abs(this.jumpFraction - 0.5);
      sy += Math.round(this.jumpPeak * (4 * jp * jp - 1));
    }
    ctx.globalAlpha = this.opacity / 255;
    if (this.blend === 1) ctx.globalCompositeOperation = 'lighter';
    if (this.tileId > 0) {
      G.Tilemap.drawTile(ctx, this.map.tileset, this.tileId, sx, sy);
    } else if (this.characterName) {
      const img = G.Assets.get(G.Assets.character(this.characterName));
      if (img) {
        const fw = img.width / 4, fh = img.height / 4;
        const row = { 2: 0, 4: 1, 6: 2, 8: 3 }[this.direction] || 0;
        const dx = sx + 8 - fw / 2;
        let dy = sy + 16 - fh + (this.yOffset || 0);
        if (/offset/i.test(this.characterName)) dy += 8;
        const bush = this.bushDepth;
        if (bush > 0 && bush < fh) {
          ctx.drawImage(img, this.pattern * fw, row * fh, fw, fh - bush, dx, dy, fw, fh - bush);
          ctx.globalAlpha *= 0.5;
          ctx.drawImage(img, this.pattern * fw, row * fh + fh - bush, fw, bush, dx, dy + fh - bush, fw, bush);
        } else {
          ctx.drawImage(img, this.pattern * fw, row * fh, fw, fh, dx, dy, fw, fh);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.bubble) this.drawBubble(ctx, sx, sy);
  }
  drawBubble(ctx, sx, sy) {
    const b = this.bubble;
    if (G.time > b.until) { this.bubble = null; return; }
    // FRLG-style "!" speech bubble above the character
    const y = sy - 22;
    G.UI.frame(ctx, sx + 2, y, 12, 14, 'menu');
    ctx.fillStyle = '#f8f8f8'; ctx.fillRect(sx + 6, y + 13, 4, 2);
    G.Font.draw(ctx, b.kind === 'question' ? '?' : '!', sx + 6, y, ['#e03020', null], { shadow: false });
  }
};
