update public.jokes
set text = case text
  when 'joke 1' then 'Why did the developer go broke? Because they used up all their cache.'
  when 'joke 2' then 'Why do programmers prefer dark mode? Because light attracts bugs.'
  when 'joke 3' then 'There are 10 types of people: those who understand binary and those who do not.'
  else text
end
where text in ('joke 1', 'joke 2', 'joke 3');