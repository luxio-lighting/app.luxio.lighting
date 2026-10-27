export const starterSource = `-- @preview 00d2ff,4fff7f
-- @parameter Speed,Slider,1,0.1,5

-- A slow, looping Luxio gradient. Speed 1 takes 20 seconds per cycle.
local phase = 0
local previous = 0

function setup()
  previous = luxio_millis()
end

function loop()
  local now = luxio_millis()
  phase = (phase + (now - previous) / 20000 * luxio_get_parameter("Speed")) % 1
  previous = now

  local count = luxio_get_pixel_count()
  for i = 0, count - 1 do
    local position = i / math.max(1, count - 1)
    local blend = (1 - math.cos(position * math.pi - phase * 2 * math.pi)) / 2
    luxio_set_pixel_color(i,
      math.floor(79 * blend),
      math.floor(210 + 45 * blend),
      math.floor(255 - 128 * blend))
  end
end
`;
