# Converts the kit's overworld animations (Data/Animations.rxdata: grass
# rustle, dust, ...) into data/map_animations.json.
# Usage: ruby tools/mapanims2json.rb "<Essentials Data dir>" data/map_animations.json
require 'json'

class Color; def self._load(s); c = allocate; c.instance_variable_set(:@v, s.unpack('D4')); c; end; end
class Tone; def self._load(s); allocate; end; end
# RMXP Table: [dims, xsize, ysize, zsize, count] then int16 values (x fastest)
class Table
  attr_reader :xsize, :ysize, :data
  def self._load(s)
    t = allocate
    _dims, xs, ys, _zs, n = s.unpack('l5')
    t.instance_variable_set(:@xsize, xs)
    t.instance_variable_set(:@ysize, ys)
    t.instance_variable_set(:@data, s[20, n * 2].unpack('s*'))
    t
  end
  def [](x, y); @data[x + y * @xsize]; end
end
module RPG
  class Animation; end
  class Animation::Frame; end
  class Animation::Timing; end
  class AudioFile; end
end

src, dst = ARGV
anims = Marshal.load(File.binread(File.join(src, 'Animations.rxdata')))
out = {}
anims.each do |a|
  next if a.nil?
  g = ->(o, n) { o.instance_variable_get(n) }
  name = g.(a, :@name).to_s.force_encoding('UTF-8').scrub
  next if name.empty?
  frames = g.(a, :@frames).map do |f|
    t = g.(f, :@cell_data)
    (0...g.(f, :@cell_max)).map do |i|
      next nil if t[i, 0].nil? || t[i, 0] < 0
      # [pattern, x, y, zoom %, angle, mirror, opacity, blend]
      (0...8).map { |k| t[i, k] }
    end.compact
  end
  out[g.(a, :@id)] = {
    name: name,
    graphic: g.(a, :@animation_name).to_s.force_encoding('UTF-8').scrub,
    position: g.(a, :@position),
    frames: frames,
  }
end
File.write(dst, JSON.generate(out))
puts "#{dst}: #{out.size} map animations"
