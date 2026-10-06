-- define data and its extend and raw methods in lua, JS will later read this global to extract it
-- and may inject into data.raw to pre-populate the table
-- this is handled in lua instead of a JS callback for performance reasons
-- thousands of data.extend calls doing interop into JS is unusably slow

data = data or {}
data.raw = data.raw or {}

function data.extend(self, values)
    -- Handle calling data.extend instead of data:extend
    if(values == nil) then
        values = self
    end
    for i, value in ipairs(values) do
        -- space-age tries to extend on the string "./data/__space-age__/sound/ambient/space/interlude-6/interlude-6.lua" 
        -- (i.e. not a valid prototype object, just that string) so we need to gracefully handle invalid objects
        if(value.name ~= nil and value.type ~= nil) then
            data.raw[value.type] = data.raw[value.type] or {}
            data.raw[value.type][value.name] = value
        end
    end
end