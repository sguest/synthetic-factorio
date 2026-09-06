local old_require = require

-- Wrapper around lua's require() to handle several Factorio-isms that are used by either vanilla or other mods that break under regular lua import rules

-- Mods can require() the same filename across different mods, and each one will load its own version
-- for example both mods base and space-age import "prototypes.tile.tiles" but refer to different files
-- The lua spec says such an import re-uses the existing module, even if package.paths has changed, so this is a workaround
-- Each mod starts in its own "context" defined by the global current_mod_root_path
-- Imports are first attempted from this root path, and then allowed to fall back on error to find things like lualib
-- If a mod explicitly imports from another mod using the double-underscore syntax, i.e. require("__modname__.file")
-- then current_mod_root_path is set to that mod, and then restored after

-- This cannot be handled by running mods in different lua contexts because mods can re-use globals that were previously declared
-- for example "apply_heat_pipe_glow" is defined in base.prototypes.entity.entities, but then used in space-age.prototypes.entity.entities without being re-declared
-- Therefore both mods need to load in the same lua context to preserve globals

function require(name, ...)
    local mod_changed = false
    local previous_mod = current_mod_root_path
    local new_name = name
    if(string.find(name, '__')) then
        mod_changed = true
        local end_index = string.find(name, '__', 3)
        current_mod_root_path = string.sub(name, 3, end_index - 1)
    else
        new_name = '__' .. current_mod_root_path .. '__.' .. name
    end

    -- This is the first load attempt that tries within the context of current_mod_root_path
    local status, lib = pcall(old_require, new_name, ...)
    if(mod_changed) then
        current_mod_root_path = previous_mod
    end
    if(status) then return lib end

    -- First import has failed, fall back to the exact name that was provided. Most commonly this is loading lualib
    -- though it also handles the case where mods require paths from vanilla mods without specifying the mod prefix
    status, lib = pcall(old_require, name, ...)
    if(status) then return lib end

    -- The factorio-data repo (https://github.com/wube/factorio-data) is the source for the data for the vanilla "mods"
    -- This repo doesn't have things like graphics, sounds or menu simulations, but these are still require()d in many places from the existing lua files
    -- The global suppress_require_errors is set during vanilla mod loading to suppress these
    -- They are also suppressed when loading from the vanilla mod namespaces to handle loads from other mods
    -- By default non-vanilla mods do not suppress, set the global suppress_require_errors = true to change
    if(suppress_require_errors or string.find(name, '__base__') or string.find(name, '__space-age__', 1, true) or string.find(name, '__quality__') or string.find(name, '__recycler__') or string.find(name, '__elevated-rails__', 1, true)) then
        if(string.find(name, 'graphics')) then
            return { width = 1, height = 1, shift = util.by_pixel(1.0, 1.0), line_length = 5 }
        end
        if(string.find(name, 'menu-simulations', 1, true) or string.find(name, 'sound')) then
            return {}
        end
    end

    error(lib)
end