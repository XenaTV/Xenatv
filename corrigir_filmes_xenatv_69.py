#!/usr/bin/env python3
"""Patch pontual de catalogo de filmes para fontes IPTV da XenaTV 6.9.
Execute na raiz do repositorio Android gerado, depois da restauracao do projeto.
Nao altera a consulta de series.
"""
from pathlib import Path
import re
import sys

root = Path('xena-premium/XenaTV_Android/app/src/main/java/br/com/xenatv/app')
main, store = root / 'MainActivity.java', root / 'ChannelStore.java'
if not main.exists() or not store.exists():
    sys.exit('ERRO: execute apos restaurar o projeto Android; arquivos Java ausentes.')
a, b = main.read_text(), store.read_text()
needle = 'db.query(group.title,kind,"",cap,0)'
replacement = '(MOVIES.equals(kind) ? db.queryPlatformMovies(group.title,cap) : db.query(group.title,kind,"",cap,0))'
if needle not in a and replacement not in a:
    sys.exit('ERRO: chamada da consulta mudou; nenhuma alteracao aplicada.')

signature = 'public List<Channel> query(String group,String kind,String search,int limit,int offset){'
if signature not in b:
    sys.exit('ERRO: assinatura da consulta mudou; nenhuma alteracao aplicada.')

method = '''public List<Channel> queryPlatformMovies(String category,int limit){
    ArrayList<Channel> items=new ArrayList<>();
    String vod="(lower(address) LIKE '%/movie/%' OR lower(address) LIKE '%/vod/%' OR lower(address) LIKE '%.mp4%' OR lower(address) LIKE '%.mkv%' OR lower(address) LIKE '%.avi%' OR lower(address) LIKE '%.m4v%' OR lower(address) LIKE '%.webm%')";
    String sql="SELECT c._id,c.title,c.address,c.category,c.logo,c.kind,"+
        "EXISTS(SELECT 1 FROM favorites f WHERE f.address=c.address) FROM channels c "+
        "WHERE c.category=? AND (c.kind='Filmes' OR (c.kind='TV' AND "+vod+")) "+
        "ORDER BY c._id LIMIT ?";
    try(Cursor c=getReadableDatabase().rawQuery(sql,new String[]{category,String.valueOf(limit)})){
        while(c.moveToNext())items.add(new Channel(c.getLong(0),c.getString(1),c.getString(2),c.getString(3),c.getString(4),c.getString(5),c.getInt(6)!=0));
    }
    return items;
}
'''
pattern = r'(public List<Group> platformCategories\(String kind,String platform\)\s*\{[\s\S]*?getReadableDatabase\(\)\.rawQuery\(\s*)("SELECT category,count\(\*\) FROM channels WHERE kind=\? GROUP BY category ORDER BY count\(\*\) DESC,category",\s*new String\[\]\{kind\})'
substitution = '''("Filmes".equals(kind)
    ? "SELECT category,count(*) FROM channels WHERE kind='Filmes' OR (kind='TV' AND (lower(address) LIKE '%/movie/%' OR lower(address) LIKE '%/vod/%' OR lower(address) LIKE '%.mp4%' OR lower(address) LIKE '%.mkv%' OR lower(address) LIKE '%.avi%' OR lower(address) LIKE '%.m4v%' OR lower(address) LIKE '%.webm%')) GROUP BY category ORDER BY count(*) DESC,category"
    : "SELECT category,count(*) FROM channels WHERE kind=? GROUP BY category ORDER BY count(*) DESC,category"),
    "Filmes".equals(kind)?new String[0]:new String[]{kind})'''
if 'public List<Channel> queryPlatformMovies(' not in b:
    candidate, n = re.subn(pattern, lambda m: m.group(1) + substitution, b, count=1)
    if n != 1:
        sys.exit('ERRO: SQL das categorias mudou; nenhuma alteracao aplicada.')
    b = candidate.replace(signature, method + '\n              ' + signature, 1)
if needle in a:
    a = a.replace(needle, replacement, 1)
main.write_text(a)
store.write_text(b)
print('OK: busca de filmes ampliada para VOD importado como TV; consulta de series preservada.')
