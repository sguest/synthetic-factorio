local old_require = require

-- The factorio-data repo (https://github.com/wube/factorio-data) is the source for the data for the vanilla "mods"
-- This repo doesn't have things like graphics, sounds or menu simulations, but these are still require()d in many places from the existing lua files
-- The global suppress_require_errors is set during vanilla mod loading to suppress these
-- They are also suppressed when loading from the vanilla mod namespaces to handle loads from other mods
-- By default non-vanilla mods do not suppress, set the global suppress_require_errors = true to change

function require(name, ...)
    local status, lib = pcall(old_require, name, ...)
    if(status) then return lib end

    if(suppress_require_errors or string.find(name, '__base__') or string.find(name, '__space-age__', 1, true) or string.find(name, '__quality__') or string.find(name, '__elevated-rails__', 1, true)) then
        if(string.find(name, 'graphics')) then
            return { width = 1, height = 1, shift = util.by_pixel(1.0, 1.0), line_length = 5 }
        end
        if(string.find(name, 'menu-simulations', 1, true) or string.find(name, 'sound')) then
            return {}
        end
    end

    error(lib)
end