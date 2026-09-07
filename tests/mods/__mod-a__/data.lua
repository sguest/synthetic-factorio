data:extend({{
    type = "item",
    name = "test-item",
    icon = "__mod-a__/graphics/test-item.png"
}})

if mods['mod-d'] then
    log('Detected mod d from mod a');
end

if settings.startup['test-string-setting'] then
    log('string setting is ' .. settings.startup['test-string-setting'].value)
end
