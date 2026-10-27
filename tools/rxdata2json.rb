# Converts RPG Maker XP .rxdata files (Ruby Marshal) from the Essentials kit
# into plain JSON so tools/convert.js can turn them into game data.
#
# Usage: ruby tools/rxdata2json.rb <Essentials Data dir> <output dir>
require 'json'
require 'fileutils'

class Table
  def self._load(s)
    t = allocate
    _dim, x, y, z, n = s.unpack('L5')
    t.instance_variable_set(:@h, { 'x' => x, 'y' => y, 'z' => z, 'data' => s[20, n * 2].unpack('s*') })
    t
  end
  def to_h; @h; end
end

class Color
  def self._load(s); c = allocate; c.instance_variable_set(:@v, s.unpack('D4')); c; end
  def to_h; @v; end
end

class Tone
  def self._load(s); c = allocate; c.instance_variable_set(:@v, s.unpack('D4')); c; end
  def to_h; @v; end
end

module RPG; end
%w[Actor Animation Animation::Frame Animation::Timing Armor Class Class::Learning
   Enemy Enemy::Action Item Event Event::Page Event::Page::Condition
   Event::Page::Graphic Map MapInfo Tileset CommonEvent System System::Words
   System::TestBattler Skill State Troop Troop::Member Troop::Page
   Troop::Page::Condition Weapon MoveRoute MoveCommand EventCommand AudioFile].each do |n|
  RPG.module_eval("class #{n}; end")
end

def conv(o)
  case o
  when Table, Color, Tone then o.to_h
  when Array then o.map { |e| conv(e) }
  when Hash
    h = {}
    o.each { |k, v| h[k.to_s] = conv(v) }
    h
  when String then o.dup.force_encoding('UTF-8').scrub
  when Symbol then o.to_s
  when Numeric, TrueClass, FalseClass, NilClass then o
  else
    h = { '_c' => o.class.name }
    o.instance_variables.each { |iv| h[iv.to_s[1..-1]] = conv(o.instance_variable_get(iv)) }
    h
  end
end

src, dst = ARGV
FileUtils.mkdir_p(dst)
wanted = /\A(Map\d+|MapInfos|Tilesets|CommonEvents|System)\.rxdata\z/
Dir.children(src).sort.each do |f|
  next unless f =~ wanted
  data = Marshal.load(File.binread(File.join(src, f)))
  File.write(File.join(dst, f.sub('.rxdata', '.json')), JSON.generate(conv(data)))
end
puts "rxdata2json: wrote #{Dir.children(dst).size} files to #{dst}"
