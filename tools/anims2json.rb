# Converts the kit's battle animations (Data/PkmnAnimations.rxdata) and the
# move -> animation table (Data/move2anim.dat) into data/animations.json.
# Usage: ruby tools/anims2json.rb "<Essentials Data dir>" data/animations.json
require 'json'

class Color
  def self._load(s); c = allocate; c.instance_variable_set(:@v, s.unpack('D4')); c; end
  def to_a; @v; end
end
class Tone
  def self._load(s); c = allocate; c.instance_variable_set(:@v, s.unpack('D4')); c; end
end
class Table; def self._load(s); allocate; end; end
class PBAnimations < Array; end
class PBAnimation < Array; end
class PBAnimTiming; end
module RPG; class AudioFile; end; end

src, dst = ARGV
anims = Marshal.load(File.binread(File.join(src, 'PkmnAnimations.rxdata')))
list = anims.instance_variable_get(:@array) || anims
out = list.map do |a|
  next nil if a.nil?
  frames = (a.instance_variable_get(:@array) || a).map do |frame|
    frame.map do |cel|
      next nil if cel.nil? || cel[6] == 0 # VISIBLE
      # [pattern, x, y, zoomx, zoomy, angle, mirror, blend, opacity, focus, priority]
      [cel[7], cel[0], cel[1], cel[2], cel[11] || cel[2], cel[3], cel[4], cel[5], cel[8], cel[26] || 4, cel[25] || 1]
    end
  end
  timing = (a.instance_variable_get(:@timing) || []).map do |t|
    g = ->(n) { t.instance_variable_get(n) }
    fc = g.(:@flashColor)
    { frame: g.(:@frame), type: g.(:@timingType) || 0, name: g.(:@name).to_s.force_encoding('UTF-8').scrub,
      volume: g.(:@volume), pitch: g.(:@pitch), flashScope: g.(:@flashScope) || 0,
      flashColor: fc.respond_to?(:to_a) ? fc.to_a : nil, flashDuration: g.(:@flashDuration) || 0 }
  end
  { id: a.instance_variable_get(:@id), name: a.instance_variable_get(:@name).to_s.force_encoding('UTF-8').scrub,
    graphic: a.instance_variable_get(:@graphic).to_s.force_encoding('UTF-8').scrub,
    position: a.instance_variable_get(:@position), frames: frames, timing: timing }
end
m2a = Marshal.load(File.binread(File.join(src, 'move2anim.dat')))
conv = ->(h) { r = {}; (h || {}).each { |k, v| r[k.to_s] = v }; r }
File.write(dst, JSON.generate({ animations: out, moves: conv.(m2a[0]), oppMoves: conv.(m2a[1]) }))
puts "anims2json: #{out.compact.size} animations"
