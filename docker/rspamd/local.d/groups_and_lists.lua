-- SpamProxy: Google Groups and Mailing List detection
-- Adds symbols that can be used for scoring in the web interface

-- Detect Google Groups
rspamd_config:register_symbol{
    name = "GOOGLE_GROUP",
    score = 0.1,
    group = "mailing_lists",
    description = "Message from Google Groups",
    callback = function(task)
        if task:get_header('X-Google-Group-Id') then
            return true
        end
        local lu = task:get_header('List-Unsubscribe')
        if lu and string.find(lu:lower(), 'googlegroups') then
            return true
        end
        local lp = task:get_header('List-Post')
        if lp and string.find(lp:lower(), 'googlegroups') then
            return true
        end
        return false
    end
}

-- Detect any mailing list
rspamd_config:register_symbol{
    name = "MAILING_LIST",
    score = 0.0,
    group = "mailing_lists",
    description = "Message from a mailing list",
    callback = function(task)
        -- List-Id header is the standard indicator
        if task:get_header('List-Id') then
            return true
        end
        if task:get_header('List-Unsubscribe') then
            return true
        end
        -- Precedence: bulk or list
        local prec = task:get_header('Precedence')
        if prec then
            local p = prec:lower()
            if p == 'bulk' or p == 'list' then
                return true
            end
        end
        return false
    end
}

-- Google Groups + spam indicators = high score
rspamd_config:register_symbol{
    name = "GOOGLE_GROUP_SPAM",
    score = 6.0,
    group = "mailing_lists",
    description = "Google Groups message with spam indicators",
    callback = function(task)
        -- Only trigger if GOOGLE_GROUP is set
        if not task:get_header('X-Google-Group-Id') then
            local lu = task:get_header('List-Unsubscribe')
            if not lu or not string.find(lu:lower(), 'googlegroups') then
                return false
            end
        end
        -- Check for spam indicators
        local from = task:get_from('mime')
        if from and from[1] then
            local addr = from[1].addr or ''
            -- Freemail sender via Google Groups is very suspicious
            local freemail = {'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
                             'mail.ru', 'yandex.ru', 'qq.com', '163.com', 'aol.com'}
            for _, domain in ipairs(freemail) do
                if string.find(addr:lower(), domain, 1, true) then
                    return true
                end
            end
        end
        return false
    end
}

-- Mailing list from unknown/suspicious source
rspamd_config:register_symbol{
    name = "BULK_UNSOLICITED",
    score = 3.0,
    group = "mailing_lists",
    description = "Bulk/list mail not from a known mailing list",
    callback = function(task)
        local prec = task:get_header('Precedence')
        if not prec then return false end
        if prec:lower() ~= 'bulk' then return false end
        -- Bulk mail without proper List-Id is suspicious
        if not task:get_header('List-Id') then
            return true
        end
        return false
    end
}
